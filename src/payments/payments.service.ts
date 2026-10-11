import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { GiftsService } from '../gifts/gifts.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { badRequest, notFound } from '../common/http.js';
import { randomToken, sha256 } from '../domain/tokens.js';
import { assertTransition } from '../domain/transitions.js';
import { GIFT_TRANSITIONS, PAYMENT_TRANSITIONS } from '../domain/transitions.js';
import { CashfreeProvider } from './cashfree/cashfree.provider.js';
import { verifyCashfreeWebhook } from './cashfree/signature.js';
import type { CheckoutDto } from '../gifts/gifts.dto.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gifts: GiftsService,
    private readonly inventory: InventoryService,
    private readonly cashfree: CashfreeProvider,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async checkout(senderId: string, giftId: string, dto: CheckoutDto) {
    const prepared = await this.gifts.prepareCheckout(senderId, giftId, dto);
    const returnUrl = `${this.config.get('PUBLIC_WEB_URL', { infer: true })}/checkout/return?order_id={order_id}`;
    const order = await this.cashfree.createOrder({
      orderId: prepared.orderId,
      amountPaise: prepared.gift.totalPaise,
      currency: prepared.gift.currency,
      customerId: senderId,
      customerPhone: prepared.phone,
      customerEmail: prepared.email,
      returnUrl,
    });
    const payment = await this.prisma.payment.create({
      data: {
        giftId,
        providerOrderId: order.providerOrderId,
        paymentSessionId: order.paymentSessionId,
        amountPaise: prepared.gift.totalPaise,
        status: 'PENDING',
      },
    });
    return {
      paymentId: payment.id,
      status: payment.status,
      checkout: {
        provider: 'CASHFREE',
        sessionId: order.paymentSessionId,
        mode: this.config.get('CASHFREE_ENV', { infer: true }),
      },
    };
  }

  async statusForSender(senderId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { gift: true } });
    if (!payment || payment.gift.senderId !== senderId) throw notFound();
    return this.publicStatus(payment.id);
  }

  async statusByOrder(senderId: string, orderId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: orderId },
      include: { gift: true },
    });
    if (!payment || payment.gift.senderId !== senderId) throw notFound();
    if (payment.status === 'PENDING') await this.reconcilePayment(payment.id);
    return this.publicStatus(payment.id);
  }

  async handleWebhook(rawBody: string, timestamp?: string, signature?: string) {
    const secret = this.config.get('CASHFREE_WEBHOOK_SECRET', { infer: true });
    const valid = verifyCashfreeWebhook({ timestamp, signature, rawBody, secret });
    if (!valid) throw badRequest('WEBHOOK_INVALID', 'Webhook signature was rejected.');
    const payload = JSON.parse(rawBody) as {
      type?: string;
      data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string; payment_status?: string } };
    };
    const orderId = payload.data?.order?.order_id;
    if (!orderId) return { ok: true };
    const eventId =
      payload.data?.payment?.cf_payment_id && payload.type
        ? `${payload.type}:${payload.data.payment.cf_payment_id}`
        : createHash('sha256').update(rawBody).digest('hex');
    const existing = await this.prisma.paymentEvent.findUnique({ where: { providerEventId: eventId } });
    if (existing) return { ok: true, duplicate: true };
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    await this.prisma.paymentEvent.create({
      data: {
        providerEventId: eventId,
        paymentId: payment?.id,
        payload,
      },
    });
    if (payment) await this.reconcilePayment(payment.id);
    return { ok: true };
  }

  async reconcilePayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { gift: { include: { items: true, reservations: true } } },
    });
    if (!payment || payment.status === 'PAID' || payment.status === 'FAILED') return;
    const remote = await this.cashfree.fetchPayments(payment.providerOrderId);
    if (remote.status === 'SUCCESS') {
      if (remote.amountPaise && remote.amountPaise !== payment.amountPaise) {
        this.logger.error(`Amount mismatch for ${payment.providerOrderId}`);
        return;
      }
      await this.markPaid(payment.id, remote.paymentId);
      return;
    }
    if (remote.status === 'FAILED' || remote.status === 'USER_DROPPED') {
      await this.transitionPayment(payment.id, payment.status, 'FAILED', remote.paymentId);
    }
  }

  async markPaid(paymentId: string, providerPaymentId: string | null) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { gift: { include: { items: true, reservations: true, sender: true } } },
    });
    if (!payment || payment.status === 'PAID') return;
    const gift = payment.gift;
    if (gift.status === 'PAYMENT_PENDING') {
      await this.activateGift(payment.id, gift, providerPaymentId);
      return;
    }
    if (gift.status === 'CANCELLED') {
      await this.recoverOrRefund(payment.id, gift, providerPaymentId);
    }
  }

  async refundPayment(paymentId: string, actorId: string | null, reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { gift: true } });
    if (!payment || payment.status !== 'PAID') throw badRequest('NOT_REFUNDABLE', 'Only a captured payment can be refunded.');
    const refundId = `rf_${randomToken(8)}`;
    const remote = await this.cashfree.refund({
      providerOrderId: payment.providerOrderId,
      refundId,
      amountPaise: payment.amountPaise,
    });
    const refund = await this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        providerRefundId: remote.providerRefundId,
        amountPaise: payment.amountPaise,
        reason,
        status: remote.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
      },
    });
    if (refund.status === 'SUCCESS') {
      await this.finishRefund(payment.giftId);
    }
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'payment.refund',
        entity: 'Payment',
        entityId: payment.id,
        metadata: { reason, refundId: refund.id },
      },
    });
    return refund;
  }

  private async activateGift(
    paymentId: string,
    gift: {
      id: string;
      status: string;
      sender: { phone: string | null; email: string | null };
      reservations: Array<{ id: string; variantId: string; quantity: number; status: string }>;
    },
    providerPaymentId: string | null,
  ) {
    assertTransition(GIFT_TRANSITIONS, gift.status, 'READY_TO_SEND');
    const token = randomToken(32);
    const days = this.config.get('CLAIM_WINDOW_DAYS', { infer: true });
    const claimExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      const paymentUpdated = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ['CREATED', 'PENDING'] } },
        data: { status: 'PAID', providerPaymentId },
      });
      if (paymentUpdated.count !== 1) return;
      for (const reservation of gift.reservations.filter((row) => row.status === 'ACTIVE')) {
        await this.inventory.commit(tx, reservation.variantId, reservation.quantity);
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: 'COMMITTED' },
        });
      }
      const giftUpdated = await tx.gift.updateMany({
        where: { id: gift.id, status: 'PAYMENT_PENDING' },
        data: { status: 'READY_TO_SEND', tokenHash: sha256(token), claimExpiresAt },
      });
      if (giftUpdated.count !== 1) throw new Error('GIFT_ACTIVATE_RACE');
      await tx.giftEvent.create({
        data: { giftId: gift.id, type: 'PAID', fromStatus: 'PAYMENT_PENDING', toStatus: 'READY_TO_SEND' },
      });
      const items = await tx.giftItem.findMany({ where: { giftId: gift.id } });
      for (const item of items) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (variant) {
          await tx.product.update({
            where: { id: variant.productId },
            data: { giftedCount: { increment: item.quantity } },
          });
        }
      }
    });
    const url = `${this.config.get('PUBLIC_WEB_URL', { infer: true })}/gifts/sent/${gift.id}`;
    if (gift.sender.phone) {
      await this.notifications.sendWhatsAppText(gift.sender.phone, 'givora_gift_ready', [url]);
    }
    if (gift.sender.email) {
      await this.notifications.sendEmail(
        gift.sender.email,
        'Your Givora gift is ready to share',
        `Your gift is paid. Open it here to copy the redeem link: ${url}`,
      );
    }
    return token;
  }

  private async recoverOrRefund(
    paymentId: string,
    gift: {
      id: string;
      items: Array<{ variantId: string; quantity: number }>;
    },
    providerPaymentId: string | null,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const item of gift.items) {
          await this.inventory.reserve(tx, item.variantId, item.quantity);
          await this.inventory.commit(tx, item.variantId, item.quantity);
        }
        const moved = await tx.gift.updateMany({
          where: { id: gift.id, status: 'CANCELLED' },
          data: {
            status: 'READY_TO_SEND',
            needsRefund: false,
            tokenHash: sha256(randomToken(32)),
            claimExpiresAt: new Date(Date.now() + this.config.get('CLAIM_WINDOW_DAYS', { infer: true }) * 86400000),
          },
        });
        if (moved.count !== 1) throw new Error('RECOVERY_RACE');
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'PAID', providerPaymentId },
        });
      });
    } catch {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'PAID', providerPaymentId },
      });
      await this.prisma.gift.update({ where: { id: gift.id }, data: { needsRefund: true } });
      await this.refundPayment(paymentId, null, 'Late payment after stock was released');
    }
  }

  private async transitionPayment(id: string, from: string, to: string, providerPaymentId: string | null) {
    assertTransition(PAYMENT_TRANSITIONS, from, to);
    await this.prisma.payment.updateMany({
      where: { id, status: from as 'PENDING' },
      data: { status: to as 'FAILED', providerPaymentId },
    });
  }

  private async finishRefund(giftId: string) {
    await this.prisma.gift.updateMany({
      where: { id: giftId, status: { in: ['EXPIRED', 'REVOKED', 'CLAIMED', 'CANCELLED'] } },
      data: { status: 'REFUNDED', needsRefund: false },
    });
    await this.prisma.giftEvent.create({
      data: { giftId, type: 'REFUNDED', toStatus: 'REFUNDED' },
    });
  }

  private async publicStatus(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { gift: true } });
    if (!payment) throw notFound();
    return {
      paymentId: payment.id,
      status: payment.status,
      giftId: payment.giftId,
      giftStatus: payment.gift.status,
    };
  }
}
