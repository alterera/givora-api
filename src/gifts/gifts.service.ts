import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { TelegramSender } from '../telegram/telegram.sender.js';
import { MediaService } from '../media/media.service.js';
import { AuditService } from '../audit/audit.service.js';
import { badRequest, forbidden, notFound } from '../common/http.js';
import { assertTransition, SHIPMENT_TRANSITIONS } from '../domain/transitions.js';
import { tierForEarnedAura } from '../aura/rules.js';
import type { AddressDto, RedeemDto } from './gifts.dto.js';

const giftInclude = {
  orderItem: { include: { order: { include: { creator: true } } } },
  buyer: { select: { id: true, displayName: true, earnedAura: true } },
  shipment: true,
  redemption: true,
  digitalAccess: true,
  events: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly telegram: TelegramSender,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async received(userId: string) {
    const gifts = await this.prisma.gift.findMany({
      where: { recipientId: userId },
      include: giftInclude,
      orderBy: { createdAt: 'desc' },
    });
    return gifts.map((gift) => this.recipientView(gift));
  }

  async getOne(userId: string, id: string, role: 'CUSTOMER' | 'ADMIN') {
    const gift = await this.prisma.gift.findUnique({ where: { id }, include: giftInclude });
    if (!gift) throw notFound();
    if (role !== 'ADMIN' && gift.recipientId !== userId && gift.buyerId !== userId) throw forbidden();
    if (gift.buyerId === userId && gift.recipientId !== userId) return this.buyerGift(gift);
    return this.recipientView(gift);
  }

  async opened(userId: string, id: string) {
    const gift = await this.mustRecipient(userId, id);
    if (!gift.openedAt) {
      await this.prisma.gift.update({ where: { id }, data: { openedAt: new Date() } });
      await this.prisma.giftEvent.create({ data: { giftId: id, type: 'OPENED' } });
    }
    return { ok: true };
  }

  async redeem(userId: string, id: string, dto: RedeemDto) {
    const gift = await this.mustRecipient(userId, id);
    if (gift.status !== 'AWAITING_REDEMPTION') throw badRequest('GIFT_NOT_READY', 'This gift cannot be redeemed.');
    if (gift.expiresAt.getTime() < Date.now()) throw badRequest('GIFT_EXPIRED', 'This gift has expired.');
    if (gift.orderItem.productType === 'DIGITAL') {
      const asset = await this.prisma.digitalAsset.findFirst({
        where: { product: { variants: { some: { id: gift.orderItem.variantId } } } },
      });
      if (!asset) throw badRequest('FILE_MISSING', 'This digital gift is not ready yet.');
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.gift.updateMany({
          where: { id, status: 'AWAITING_REDEMPTION' },
          data: { status: 'FULFILLED' },
        });
        if (moved.count !== 1) throw badRequest('GIFT_NOT_READY', 'This gift was already redeemed.');
        await tx.digitalAccess.create({ data: { giftId: id } });
        await tx.giftEvent.create({ data: { giftId: id, type: 'DIGITAL_READY', toStatus: 'FULFILLED' } });
      });
      await this.telegram.notifyUser(gift.buyer, 'Your digital gift is now available to the creator.', `o_${gift.orderItem.orderId}`);
      return this.getOne(userId, id, 'CUSTOMER');
    }
    const address = await this.resolveAddress(userId, dto);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.gift.updateMany({
        where: { id, status: 'AWAITING_REDEMPTION' },
        data: { status: 'REDEEMED' },
      });
      if (moved.count !== 1) throw badRequest('GIFT_NOT_READY', 'This gift was already redeemed.');
      await tx.redemption.create({
        data: {
          giftId: id,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
        },
      });
      await tx.shipment.create({
        data: { giftId: id, events: { create: { toStatus: 'PENDING', note: 'Redeemed' } } },
      });
      await tx.giftEvent.create({ data: { giftId: id, type: 'REDEEMED', fromStatus: 'AWAITING_REDEMPTION', toStatus: 'REDEEMED' } });
    });
    await this.telegram.notifyUser(gift.buyer, 'The creator redeemed your gift.', `o_${gift.orderItem.orderId}`);
    return this.getOne(userId, id, 'CUSTOMER');
  }

  async download(userId: string, id: string) {
    const gift = await this.prisma.gift.findUnique({
      where: { id },
      include: { digitalAccess: true, orderItem: true },
    });
    if (!gift || gift.recipientId !== userId) throw notFound();
    if (!gift.digitalAccess || gift.status !== 'FULFILLED') throw badRequest('NOT_READY', 'Redeem the gift before downloading.');
    const asset = await this.prisma.digitalAsset.findFirst({
      where: { product: { variants: { some: { id: gift.orderItem.variantId } } } },
    });
    if (!asset) throw notFound();
    const url = await this.media.presignDownload(asset.storageKey, asset.fileName);
    await this.prisma.digitalDownload.create({ data: { accessId: gift.digitalAccess.id } });
    return { url, fileName: asset.fileName, expiresInSeconds: 300 };
  }

  async listAddresses(userId: string) {
    return this.prisma.address.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async addAddress(userId: string, dto: AddressDto) {
    this.assertIndian(dto.postalCode);
    if (dto.postalCode) {
      await this.prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return this.prisma.address.create({
      data: {
        userId,
        label: dto.label ?? 'Home',
        line1: dto.line1.trim(),
        line2: dto.line2?.trim() ?? '',
        city: dto.city.trim(),
        state: dto.state.trim(),
        postalCode: dto.postalCode,
        isDefault: true,
      },
    });
  }

  async adminShipments() {
    return this.prisma.shipment.findMany({
      include: {
        gift: { include: { orderItem: true, redemption: true, recipient: { select: { displayName: true, phone: true } } } },
        events: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async transitionShipment(id: string, to: string, actorId: string, note?: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { gift: { include: { orderItem: { include: { reservation: true } }, buyer: true } } },
    });
    if (!shipment) throw notFound();
    try {
      assertTransition(SHIPMENT_TRANSITIONS, shipment.status, to);
    } catch {
      throw badRequest('STATUS_INVALID', `Cannot move a shipment from ${shipment.status} to ${to}.`);
    }
    const updated = await this.prisma.shipment.updateMany({ where: { id, status: shipment.status }, data: { status: to as 'PACKED' } });
    if (updated.count !== 1) throw badRequest('STATUS_RACE', 'Refresh and try again.');
    await this.prisma.shipmentEvent.create({ data: { shipmentId: id, fromStatus: shipment.status, toStatus: to, note, actorId } });
    const reservation = shipment.gift.orderItem.reservation;
    if (to === 'SHIPPED' && reservation?.status === 'ACTIVE') {
      await this.prisma.$transaction(async (tx) => {
        await this.inventory.commit(tx, reservation.variantId, reservation.quantity);
        await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'COMMITTED' } });
      });
      await this.telegram.notifyUser(shipment.gift.buyer, 'Your gift has been shipped.', `o_${shipment.gift.orderItem.orderId}`);
    }
    if (to === 'DELIVERED') {
      await this.prisma.gift.updateMany({ where: { id: shipment.giftId, status: 'REDEEMED' }, data: { status: 'FULFILLED' } });
      await this.telegram.notifyUser(shipment.gift.buyer, 'Your gift was delivered.', `o_${shipment.gift.orderItem.orderId}`);
    }
    if (to === 'FAILED' || to === 'RETURNED') {
      const payment = await this.prisma.payment.findFirst({ where: { orderId: shipment.gift.orderItem.orderId, status: 'PAID' } });
      if (payment) await this.payments.refundLine(payment.id, shipment.gift.orderItem.id, `Shipment ${to.toLowerCase()}`, actorId);
    }
    await this.audit.log({ actorId, action: 'shipment.transition', entity: 'Shipment', entityId: id, metadata: { to } });
    return this.adminShipments().then((rows) => rows.find((row) => row.id === id));
  }

  async addTracking(id: string, carrier: string, trackingRef: string, actorId: string) {
    await this.prisma.shipment.update({ where: { id }, data: { carrier, trackingRef } });
    await this.audit.log({ actorId, action: 'shipment.tracking', entity: 'Shipment', entityId: id, metadata: { carrier, trackingRef } });
    return { ok: true };
  }

  async adminStats() {
    const [sales, awaiting, shipping, refunds] = await Promise.all([
      this.prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amountPaise: true }, _count: true }),
      this.prisma.gift.count({ where: { status: 'AWAITING_REDEMPTION' } }),
      this.prisma.shipment.count({ where: { status: { in: ['PENDING', 'PACKED', 'SHIPPED'] } } }),
      this.prisma.refund.aggregate({ where: { status: 'SUCCESS' }, _sum: { amountPaise: true }, _count: true }),
    ]);
    return {
      paidOrders: sales._count,
      paidPaise: sales._sum.amountPaise ?? 0,
      giftsAwaitingRedemption: awaiting,
      giftsAwaitingFulfilment: shipping,
      refunds: refunds._count,
      refundedPaise: refunds._sum.amountPaise ?? 0,
    };
  }

  private async mustRecipient(userId: string, id: string) {
    const gift = await this.prisma.gift.findUnique({ where: { id }, include: { ...giftInclude, buyer: true } });
    if (!gift) throw notFound();
    if (gift.recipientId !== userId) throw forbidden();
    return gift;
  }

  private async resolveAddress(userId: string, dto: RedeemDto) {
    if (dto.addressId) {
      const saved = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
      if (!saved) throw badRequest('ADDRESS_INVALID', 'Choose one of your saved addresses.');
      return saved;
    }
    if (!dto.line1 || !dto.city || !dto.state || !dto.postalCode) {
      throw badRequest('ADDRESS_REQUIRED', 'Add a delivery address.');
    }
    this.assertIndian(dto.postalCode);
    return this.addAddress(userId, {
      line1: dto.line1,
      line2: dto.line2,
      city: dto.city,
      state: dto.state,
      postalCode: dto.postalCode,
    });
  }

  private assertIndian(pin?: string) {
    if (!pin || !/^\d{6}$/.test(pin)) throw badRequest('ADDRESS_INVALID', 'Use an Indian PIN code.');
  }

  private recipientView(gift: {
    id: string;
    status: string;
    openedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
    orderItem: {
      productName: string;
      variantName: string;
      imageUrl: string | null;
      productType: string;
      quantity: number;
      order: { message: string; createdAt: Date; creator: { displayName: string } };
    };
    buyer: { displayName: string | null; earnedAura: number };
    shipment: { status: string; carrier: string | null; trackingRef: string | null } | null;
    redemption: { city: string; state: string; postalCode: string; line1: string } | null;
    events: Array<{ type: string; createdAt: Date; toStatus: string | null }>;
  }) {
    return {
      id: gift.id,
      status: gift.status,
      openedAt: gift.openedAt?.toISOString() ?? null,
      expiresAt: gift.expiresAt.toISOString(),
      createdAt: gift.createdAt.toISOString(),
      message: gift.orderItem.order.message,
      from: gift.buyer.displayName ?? 'A fan',
      supporter: (() => {
        const tier = tierForEarnedAura(gift.buyer.earnedAura);
        return {
          earnedAura: gift.buyer.earnedAura,
          tier: { id: tier.id, name: tier.name },
        };
      })(),
      productName: gift.orderItem.productName,
      variantName: gift.orderItem.variantName,
      imageUrl: gift.orderItem.imageUrl,
      productType: gift.orderItem.productType,
      quantity: gift.orderItem.quantity,
      shipment: gift.shipment,
      address: gift.redemption
        ? { line1: gift.redemption.line1, city: gift.redemption.city, state: gift.redemption.state, postalCode: gift.redemption.postalCode }
        : null,
      timeline: gift.events.map((event) => ({ type: event.type, status: event.toStatus, at: event.createdAt.toISOString() })),
    };
  }

  private buyerGift(gift: {
    id: string;
    status: string;
    orderItem: { productName: string; productType: string; quantity: number; orderId: string };
    shipment: { status: string; carrier: string | null; trackingRef: string | null } | null;
  }) {
    return {
      id: gift.id,
      status: gift.status,
      productName: gift.orderItem.productName,
      productType: gift.orderItem.productType,
      quantity: gift.orderItem.quantity,
      orderId: gift.orderItem.orderId,
      shipment: gift.shipment ? { status: gift.shipment.status, carrier: gift.shipment.carrier, trackingRef: gift.shipment.trackingRef } : null,
    };
  }
}
