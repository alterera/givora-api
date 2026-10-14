import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { TelegramSender } from '../telegram/telegram.sender.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { badRequest, notFound } from '../common/http.js';
import { randomToken } from '../domain/tokens.js';
import { CashfreeProvider } from './cashfree/cashfree.provider.js';
import { verifyCashfreeWebhook } from './cashfree/signature.js';
import type { CheckoutOrderDto } from '../orders/orders.dto.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly cashfree: CashfreeProvider,
    private readonly telegram: TelegramSender,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async checkout(buyerId: string, orderId: string, dto: CheckoutOrderDto) {
    const prepared = await this.orders.prepareCheckout(buyerId, orderId, dto.phone, dto.channel);
    const web = this.config.get('PUBLIC_WEB_URL', { infer: true });
    const returnPath = prepared.channel === 'telegram' ? '/tg/return' : '/return';
    const order = await this.cashfree.createOrder({
      orderId: prepared.orderCode,
      amountPaise: prepared.order.totalPaise,
      currency: prepared.order.currency,
      customerId: buyerId,
      customerPhone: prepared.phone,
      customerEmail: prepared.email,
      returnUrl: `${web}${returnPath}?orderId=${encodeURIComponent(orderId)}&order_id={order_id}`,
    });
    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        providerOrderId: order.providerOrderId,
        paymentSessionId: order.paymentSessionId,
        amountPaise: prepared.order.totalPaise,
        status: 'PENDING',
      },
    });
    const mode = this.config.get('CASHFREE_ENV', { infer: true });
    return {
      paymentId: payment.id,
      orderId,
      status: payment.status,
      checkout: {
        provider: 'CASHFREE',
        sessionId: order.paymentSessionId,
        mode,
        hostedUrl: this.cashfree.hostedCheckoutUrl(order.paymentSessionId, orderId),
      },
    };
  }

  async statusForOrder(buyerId: string, orderIdOrProviderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderIdOrProviderId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (order) {
      if (order.buyerId !== buyerId) throw notFound();
      const payment = order.payments[0];
      if (!payment) throw notFound('No payment started for this order.');
      if (payment.status === 'PENDING') await this.reconcilePayment(payment.id);
      return this.publicStatus(payment.id);
    }
    return this.statusByProviderOrder(buyerId, orderIdOrProviderId);
  }

  async statusForBuyer(buyerId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment || payment.order.buyerId !== buyerId) throw notFound();
    return this.publicStatus(payment.id);
  }

  async statusByProviderOrder(buyerId: string, providerOrderId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId },
      include: { order: true },
    });
    if (!payment || payment.order.buyerId !== buyerId) throw notFound();
    if (payment.status === 'PENDING') await this.reconcilePayment(payment.id);
    return this.publicStatus(payment.id);
  }

  async handleWebhook(rawBody: string, timestamp?: string, signature?: string) {
    const secret = this.config.get('CASHFREE_WEBHOOK_SECRET', { infer: true });
    if (!verifyCashfreeWebhook({ timestamp, signature, rawBody, secret })) {
      throw badRequest('WEBHOOK_INVALID', 'Webhook signature was rejected.');
    }
    const payload = JSON.parse(rawBody) as {
      type?: string;
      data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string } };
    };
    const orderId = payload.data?.order?.order_id;
    if (!orderId) return { ok: true };
    const eventId = payload.data?.payment?.cf_payment_id && payload.type
      ? `${payload.type}:${payload.data.payment.cf_payment_id}`
      : createHash('sha256').update(rawBody).digest('hex');
    const existing = await this.prisma.paymentEvent.findUnique({ where: { providerEventId: eventId } });
    if (existing) return { ok: true, duplicate: true };
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    await this.prisma.paymentEvent.create({
      data: { providerEventId: eventId, paymentId: payment?.id, payload },
    });
    if (payment) await this.reconcilePayment(payment.id);
    return { ok: true };
  }

  async reconcilePayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status === 'PAID' || payment.status === 'FAILED') return;
    const remote = await this.cashfree.fetchPayments(payment.providerOrderId);
    if (remote.status === 'SUCCESS') {
      if (remote.amountPaise && remote.amountPaise !== payment.amountPaise) {
        this.logger.error(`Amount mismatch ${payment.providerOrderId}`);
        return;
      }
      await this.confirmPaid(payment.id, remote.paymentId);
      return;
    }
    if (remote.status === 'FAILED' || remote.status === 'USER_DROPPED') {
      await this.prisma.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'FAILED', providerPaymentId: remote.paymentId },
      });
    }
  }

  async confirmPaid(paymentId: string, providerPaymentId: string | null) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { items: true, buyer: true, creator: { include: { user: true } } } } },
    });
    if (!payment || payment.status === 'PAID') return;
    const moved = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: { in: ['CREATED', 'PENDING'] } },
      data: { status: 'PAID', providerPaymentId },
    });
    if (moved.count !== 1) return;
    const confirmed = await this.prisma.order.updateMany({
      where: { id: payment.orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'CONFIRMED' },
    });
    if (confirmed.count !== 1) return;
    const days = this.config.get('GIFT_REDEEM_DAYS', { infer: true });
    const refunds: string[] = [];
    for (const item of payment.order.items) {
      const gifted = await this.allocateLine(item, payment.order, days);
      if (!gifted) refunds.push(item.id);
    }
    for (const itemId of refunds) {
      await this.refundLine(payment.id, itemId, 'Item unavailable after payment').catch((error) => this.logger.error(error));
    }
    await this.telegram.notifyUser(payment.order.buyer, 'Your gift purchase was successful.', `o_${payment.orderId}`);
    await this.telegram.notifyUser(
      payment.order.creator.user,
      'You received a new gift. Open GivoraWorld to unwrap it.',
      'home',
    );
    if (payment.order.buyer.phone) {
      await this.notifications.sendWhatsAppText(payment.order.buyer.phone, 'givora_order_paid', [payment.order.publicRef]);
    }
  }

  private async allocateLine(
    item: { id: string; variantId: string; quantity: number; productType: string; lineTotalPaise: number },
    order: { id: string; buyerId: string; creator: { userId: string } },
    days: number,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (item.productType === 'PHYSICAL') {
          await this.inventory.reserve(tx, item.variantId, item.quantity);
          await tx.inventoryReservation.create({
            data: { orderItemId: item.id, variantId: item.variantId, quantity: item.quantity, status: 'ACTIVE' },
          });
        }
        const gift = await tx.gift.create({
          data: {
            orderItemId: item.id,
            recipientId: order.creator.userId,
            buyerId: order.buyerId,
            expiresAt: new Date(Date.now() + days * 86_400_000),
            events: { create: { type: 'CREATED', toStatus: 'AWAITING_REDEMPTION' } },
          },
        });
        await tx.orderItem.update({ where: { id: item.id }, data: { status: 'GIFTED' } });
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (variant) {
          await tx.product.update({ where: { id: variant.productId }, data: { giftedCount: { increment: item.quantity } } });
        }
        void gift;
      });
      return true;
    } catch {
      await this.prisma.orderItem.update({ where: { id: item.id }, data: { status: 'REFUNDED_UNAVAILABLE' } });
      return false;
    }
  }

  async refundLine(paymentId: string, orderItemId: string, reason: string, actorId?: string) {
    const item = await this.prisma.orderItem.findUnique({ where: { id: orderItemId }, include: { reservation: true, gift: true } });
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!item || !payment) throw notFound();
    if (item.reservation?.status === 'ACTIVE') {
      await this.prisma.$transaction(async (tx) => {
        await this.inventory.release(tx, item.variantId, item.quantity);
        await tx.inventoryReservation.update({ where: { id: item.reservation!.id }, data: { status: 'RELEASED' } });
      });
    }
    const refundId = `rf_${randomToken(8)}`;
    const remote = await this.cashfree.refund({
      providerOrderId: payment.providerOrderId,
      refundId,
      amountPaise: item.lineTotalPaise,
    });
    await this.prisma.refund.create({
      data: {
        paymentId,
        orderItemId,
        providerRefundId: remote.providerRefundId,
        amountPaise: item.lineTotalPaise,
        reason,
        status: remote.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
      },
    });
    if (item.gift && item.gift.status !== 'REFUNDED') {
      await this.prisma.gift.update({ where: { id: item.gift.id }, data: { status: 'REFUNDED', needsRefund: false } });
      await this.prisma.giftEvent.create({
        data: { giftId: item.gift.id, type: 'REFUNDED', toStatus: 'REFUNDED' },
      });
    }
    await this.refreshOrderRefundState(payment.orderId);
    if (actorId) {
      await this.prisma.auditLog.create({
        data: { actorId, action: 'payment.refund', entity: 'OrderItem', entityId: orderItemId, metadata: { reason } },
      });
    }
    return { refunded: true };
  }

  async refundPayment(paymentId: string, actorId: string, reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: { include: { items: true } } } });
    if (!payment || payment.status !== 'PAID') throw badRequest('NOT_REFUNDABLE', 'Only a captured payment can be refunded.');
    for (const item of payment.order.items) {
      if (item.status !== 'REFUNDED_UNAVAILABLE') {
        await this.refundLine(paymentId, item.id, reason, actorId);
      }
    }
    return { ok: true };
  }

  private async refreshOrderRefundState(orderId: string) {
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    const refunded = items.filter((item) => item.status === 'REFUNDED_UNAVAILABLE').length;
    const status = refunded === 0 ? undefined : refunded === items.length ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    if (status) await this.prisma.order.update({ where: { id: orderId }, data: { status } });
  }

  private async publicStatus(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment) throw notFound();
    return { paymentId: payment.id, status: payment.status, orderId: payment.orderId, orderStatus: payment.order.status };
  }
}
