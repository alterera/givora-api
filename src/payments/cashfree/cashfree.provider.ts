import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.js';
import { paiseToRupees } from '../../domain/money.js';
import { badRequest } from '../../common/http.js';
import type { PaymentProvider, ProviderPayment } from '../payment-provider.js';

const API_TIMEOUT_MS = 8_000;

@Injectable()
export class CashfreeProvider implements PaymentProvider {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  private baseUrl() {
    return this.config.get('CASHFREE_ENV', { infer: true }) === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
  }

  private headers() {
    const appId = this.config.get('CASHFREE_APP_ID', { infer: true });
    const secret = this.config.get('CASHFREE_SECRET_KEY', { infer: true });
    if (!appId || !secret) throw badRequest('PAYMENTS_UNCONFIGURED', 'Payments are not configured yet.');
    return {
      'Content-Type': 'application/json',
      'x-client-id': appId,
      'x-client-secret': secret,
      'x-api-version': this.config.get('CASHFREE_API_VERSION', { infer: true }),
    };
  }

  /** Cashfree sessions must be opened via the JS SDK on our domain. */
  hostedCheckoutUrl(paymentSessionId: string, orderId?: string) {
    const web = this.config.get('PUBLIC_WEB_URL', { infer: true }).replace(/\/$/, '');
    const mode = this.config.get('CASHFREE_ENV', { infer: true });
    const query = new URLSearchParams({ paymentSessionId, mode });
    if (orderId) query.set('orderId', orderId);
    return `${web}/pay/cashfree?${query.toString()}`;
  }

  async createOrder(input: Parameters<PaymentProvider['createOrder']>[0]) {
    const response = await fetch(`${this.baseUrl()}/orders`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      body: JSON.stringify({
        order_id: input.orderId,
        order_amount: paiseToRupees(input.amountPaise),
        order_currency: input.currency,
        customer_details: {
          customer_id: input.customerId.slice(0, 50),
          customer_phone: input.customerPhone.replace(/^\+/, ''),
          customer_email: input.customerEmail ?? undefined,
        },
        order_meta: { return_url: input.returnUrl },
      }),
    });
    const body = (await response.json()) as {
      payment_session_id?: string;
      order_id?: string;
      message?: string;
    };
    if (!response.ok || !body.payment_session_id || !body.order_id) {
      throw badRequest('CHECKOUT_FAILED', body.message ?? 'Could not start checkout.');
    }
    return { providerOrderId: body.order_id, paymentSessionId: body.payment_session_id };
  }

  async fetchPayments(providerOrderId: string): Promise<ProviderPayment> {
    const encoded = encodeURIComponent(providerOrderId);
    const [orderRes, paymentsRes] = await Promise.all([
      fetch(`${this.baseUrl()}/orders/${encoded}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      }).catch(() => null),
      fetch(`${this.baseUrl()}/orders/${encoded}/payments`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      }).catch(() => null),
    ]);

    const orderBody = orderRes?.ok
      ? ((await orderRes.json()) as { order_status?: string; order_amount?: number })
      : null;

    if (paymentsRes?.ok) {
      const rows = (await paymentsRes.json()) as Array<{
        cf_payment_id?: string | number;
        payment_status?: string;
        payment_amount?: number;
      }>;
      const success = rows.find((row) => row.payment_status === 'SUCCESS');
      const latest = success ?? rows[0];
      if (latest) {
        const status = (latest.payment_status ?? 'PENDING') as ProviderPayment['status'];
        return {
          paymentId: latest.cf_payment_id ? String(latest.cf_payment_id) : null,
          status,
          amountPaise: Math.round((latest.payment_amount ?? 0) * 100),
        };
      }
    }

    if (orderBody?.order_status === 'PAID') {
      return {
        paymentId: null,
        status: 'SUCCESS',
        amountPaise: Math.round((orderBody.order_amount ?? 0) * 100),
      };
    }

    return { paymentId: null, status: 'NOT_ATTEMPTED', amountPaise: 0 };
  }

  async refund(input: { providerOrderId: string; refundId: string; amountPaise: number }) {
    const response = await fetch(`${this.baseUrl()}/orders/${encodeURIComponent(input.providerOrderId)}/refunds`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      body: JSON.stringify({
        refund_amount: paiseToRupees(input.amountPaise),
        refund_id: input.refundId,
        refund_note: 'Givora gift refund',
      }),
    });
    const body = (await response.json()) as { cf_refund_id?: string; refund_status?: string; message?: string };
    if (!response.ok) throw badRequest('REFUND_FAILED', body.message ?? 'Refund could not be started.');
    return {
      providerRefundId: body.cf_refund_id ?? input.refundId,
      status: body.refund_status ?? 'PENDING',
    };
  }
}
