import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AuditService } from '../audit/audit.service.js';
import { badRequest, forbidden, notFound } from '../common/http.js';
import { assertTransition, FULFILMENT_TRANSITIONS } from '../domain/transitions.js';

const FULFILMENT = ['PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;
type Fulfilment = (typeof FULFILMENT)[number];

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  async listForSender(senderId: string) {
    const gifts = await this.prisma.gift.findMany({
      where: { senderId, status: { not: 'PAYMENT_PENDING' } },
      include: { items: true, fulfilment: true, payments: true },
      orderBy: { createdAt: 'desc' },
    });
    return gifts.map((gift) => ({
      id: gift.id,
      publicRef: gift.publicRef,
      status: gift.status,
      totalPaise: gift.totalPaise,
      createdAt: gift.createdAt.toISOString(),
      items: gift.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
      })),
      fulfilment: gift.fulfilment
        ? {
            id: gift.fulfilment.id,
            orderNumber: gift.fulfilment.orderNumber,
            status: gift.fulfilment.status,
            carrier: gift.fulfilment.carrier,
            trackingRef: gift.fulfilment.trackingRef,
          }
        : null,
    }));
  }

  async getForSender(senderId: string, id: string) {
    const rows = await this.listForSender(senderId);
    const row = rows.find((item) => item.id === id);
    if (!row) throw notFound();
    return row;
  }

  async adminList() {
    return this.prisma.fulfilmentOrder.findMany({
      include: {
        gift: {
          include: {
            items: true,
            claim: { include: { address: true } },
            payments: true,
            sender: { select: { id: true, displayName: true, phone: true, email: true } },
          },
        },
        events: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async adminGet(id: string) {
    const order = await this.prisma.fulfilmentOrder.findUnique({
      where: { id },
      include: {
        gift: { include: { items: true, claim: { include: { address: true } } } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw notFound();
    return order;
  }

  async transition(id: string, to: string, actorId: string, note?: string) {
    if (!FULFILMENT.includes(to as Fulfilment)) throw badRequest('STATUS_INVALID', 'Unknown fulfilment status.');
    const order = await this.prisma.fulfilmentOrder.findUnique({ where: { id } });
    if (!order) throw notFound();
    try {
      assertTransition(FULFILMENT_TRANSITIONS, order.status, to);
    } catch {
      throw badRequest('STATUS_INVALID', `Cannot move an order from ${order.status} to ${to}.`);
    }
    const updated = await this.prisma.fulfilmentOrder.updateMany({
      where: { id, status: order.status },
      data: { status: to as Fulfilment },
    });
    if (updated.count !== 1) throw badRequest('STATUS_RACE', 'The order changed. Refresh and try again.');
    await this.prisma.fulfilmentEvent.create({
      data: { orderId: id, fromStatus: order.status, toStatus: to, note, actorId },
    });
    await this.audit.log({
      actorId,
      action: 'fulfilment.transition',
      entity: 'FulfilmentOrder',
      entityId: id,
      metadata: { from: order.status, to, note },
    });
    return this.adminGet(id);
  }

  async addShipping(id: string, carrier: string, trackingRef: string, actorId: string) {
    const order = await this.prisma.fulfilmentOrder.findUnique({ where: { id } });
    if (!order) throw notFound();
    await this.prisma.fulfilmentOrder.update({
      where: { id },
      data: { carrier, trackingRef },
    });
    await this.audit.log({
      actorId,
      action: 'fulfilment.shipping',
      entity: 'FulfilmentOrder',
      entityId: id,
      metadata: { carrier, trackingRef },
    });
    if (order.status === 'PROCESSING' || order.status === 'PLACED') {
      return this.transition(id, order.status === 'PLACED' ? 'PROCESSING' : order.status, actorId, 'Shipping added');
    }
    return this.adminGet(id);
  }

  async revokeGift(giftId: string, actorId: string, asSender = false) {
    const gift = await this.prisma.gift.findUnique({
      where: { id: giftId },
      include: { items: true, payments: true },
    });
    if (!gift) throw notFound();
    if (asSender && gift.senderId !== actorId) throw forbidden();
    if (gift.status !== 'READY_TO_SEND') {
      throw badRequest('GIFT_NOT_REVOKABLE', 'Only an unclaimed gift can be revoked.');
    }
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.gift.updateMany({
        where: { id: giftId, status: 'READY_TO_SEND' },
        data: { status: 'REVOKED', needsRefund: true },
      });
      if (moved.count !== 1) throw badRequest('GIFT_NOT_REVOKABLE', 'This gift changed. Refresh and try again.');
      for (const item of gift.items) {
        await this.inventory.restoreCommitted(tx, item.variantId, item.quantity);
      }
      await tx.giftEvent.create({
        data: { giftId, type: 'REVOKED', fromStatus: 'READY_TO_SEND', toStatus: 'REVOKED' },
      });
    });
    const paid = gift.payments.find((payment) => payment.status === 'PAID');
    if (paid) await this.payments.refundPayment(paid.id, actorId, 'Gift revoked before claim');
    await this.audit.log({ actorId, action: 'gift.revoke', entity: 'Gift', entityId: giftId });
    return { status: 'REVOKED' };
  }
}
