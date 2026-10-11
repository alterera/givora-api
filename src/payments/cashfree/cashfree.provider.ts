import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env.js';
import { paiseToRupees } from '../../domain/money.js';
import { badRequest } from '../../common/http.js';
import type { PaymentProvider, ProviderPayment } from '../payment-provider.js';

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

  async createOrder(input: Parameters<PaymentProvider['createOrder']>[0]) {
    const response = await fetch(`${this.baseUrl()}/orders`, {
      method: 'POST',
      headers: this.headers(),
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
    const response = await fetch(`${this.baseUrl()}/orders/${encodeURIComponent(providerOrderId)}/payments`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      return { paymentId: null, status: 'PENDING', amountPaise: 0 };
    }
    const rows = (await response.json()) as Array<{
      cf_payment_id?: string | number;
      payment_status?: string;
      payment_amount?: number;
    }>;
    const success = rows.find((row) => row.payment_status === 'SUCCESS');
    const latest = success ?? rows[0];
    if (!latest) return { paymentId: null, status: 'NOT_ATTEMPTED', amountPaise: 0 };
    const status = (latest.payment_status ?? 'PENDING') as ProviderPayment['status'];
    return {
      paymentId: latest.cf_payment_id ? String(latest.cf_payment_id) : null,
      status,
      amountPaise: Math.round((latest.payment_amount ?? 0) * 100),
    };
  }

  async refund(input: { providerOrderId: string; refundId: string; amountPaise: number }) {
    const response = await fetch(`${this.baseUrl()}/orders/${encodeURIComponent(input.providerOrderId)}/refunds`, {
      method: 'POST',
      headers: this.headers(),
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
