import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { badRequest, forbidden, notFound } from '../common/http.js';
import { normalizePhone } from '../domain/phone.js';
import { publicRef } from '../domain/tokens.js';
import type { CreateOrderDto } from './orders.dto.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async create(buyerId: string, dto: CreateOrderDto) {
    const creator = await this.prisma.creatorProfile.findFirst({
      where: { id: dto.creatorId, status: 'APPROVED' },
    });
    if (!creator) throw notFound('This wishlist is not available.');
    if (creator.userId === buyerId) throw badRequest('SELF_GIFT', 'You cannot buy a gift for yourself.');
    const minutes = this.config.get('PAYMENT_WINDOW_MINUTES', { infer: true });
    const lines = [];
    let subtotalPaise = 0;
    let shippingPaise = 0;
    for (const item of dto.items) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: item.variantId, isActive: true, product: { status: 'ACTIVE' } },
        include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
      });
      if (!variant) throw badRequest('VARIANT_UNAVAILABLE', 'One of these gifts is no longer available.');
      const onList = await this.prisma.wishlistItem.findFirst({
        where: { creatorId: creator.id, variantId: variant.id, isVisible: true },
      });
      if (!onList) throw badRequest('NOT_ON_WISHLIST', 'That product is not on this wishlist.');
      if (variant.product.type === 'PHYSICAL') {
        const available = variant.onHand - variant.reserved;
        if (available < item.quantity) throw badRequest('OUT_OF_STOCK', `${variant.product.name} is not available in that quantity.`);
      }
      const lineShipping = variant.product.type === 'DIGITAL' ? 0 : variant.product.shippingPaise * item.quantity;
      const goods = variant.pricePaise * item.quantity;
      subtotalPaise += goods;
      shippingPaise += lineShipping;
      lines.push({
        variantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name,
        imageUrl: variant.product.images[0]?.url ?? null,
        productType: variant.product.type,
        quantity: item.quantity,
        unitPricePaise: variant.pricePaise,
        shippingPaise: lineShipping,
        lineTotalPaise: goods + lineShipping,
      });
    }
    const phone = dto.contactPhone ? this.phone(dto.contactPhone) : undefined;
    const order = await this.prisma.order.create({
      data: {
        publicRef: publicRef(),
        buyerId,
        creatorId: creator.id,
        message: dto.message?.trim() ?? '',
        contactPhone: phone,
        channel: dto.channel ?? 'web',
        subtotalPaise,
        shippingPaise,
        totalPaise: subtotalPaise + shippingPaise,
        paymentExpiresAt: new Date(Date.now() + minutes * 60 * 1000),
        items: { create: lines },
      },
      include: { items: true, creator: true },
    });
    return this.fanView(order);
  }

  async listForBuyer(buyerId: string) {
    const orders = await this.prisma.order.findMany({
      where: { buyerId },
      include: { items: { include: { gift: { include: { shipment: true } } } }, creator: true },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order) => this.fanView(order));
  }

  async getForBuyer(buyerId: string, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { gift: { include: { shipment: true } } } }, creator: true, payments: true },
    });
    if (!order) throw notFound();
    if (order.buyerId !== buyerId) throw forbidden();
    return this.fanView(order);
  }

  async prepareCheckout(buyerId: string, id: string, phone?: string, channel?: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { buyer: true, creator: true } });
    if (!order || order.buyerId !== buyerId) throw notFound();
    if (order.status !== 'PENDING_PAYMENT') throw badRequest('ORDER_NOT_PAYABLE', 'This order is not waiting for payment.');
    if (order.paymentExpiresAt.getTime() < Date.now()) throw badRequest('ORDER_EXPIRED', 'The payment window closed.');
    let contact = order.contactPhone ?? order.buyer.phone;
    if (!contact && phone) {
      contact = this.phone(phone);
      await this.prisma.order.update({ where: { id }, data: { contactPhone: contact } });
    }
    if (!contact) throw badRequest('PHONE_REQUIRED', 'Add a mobile number so the payment receipt can be sent.');
    const attempt = order.checkoutAttempt + 1;
    await this.prisma.order.update({
      where: { id },
      data: { checkoutAttempt: attempt, channel: channel ?? order.channel },
    });
    return { order, phone: contact, email: order.buyer.email, orderCode: `${order.publicRef}_${attempt}`, channel: channel ?? order.channel };
  }

  fanView(order: {
    id: string;
    publicRef: string;
    status: string;
    message: string;
    currency: string;
    subtotalPaise: number;
    shippingPaise: number;
    totalPaise: number;
    paymentExpiresAt: Date;
    channel: string;
    createdAt: Date;
    creator: { displayName: string; slug: string };
    items: Array<{
      id: string;
      productName: string;
      variantName: string;
      imageUrl: string | null;
      productType: string;
      quantity: number;
      unitPricePaise: number;
      shippingPaise: number;
      lineTotalPaise: number;
      status: string;
      gift?: { id: string; status: string; shipment?: { status: string; carrier: string | null; trackingRef: string | null } | null } | null;
    }>;
  }) {
    return {
      id: order.id,
      publicRef: order.publicRef,
      status: order.status,
      message: order.message,
      currency: order.currency,
      subtotalPaise: order.subtotalPaise,
      shippingPaise: order.shippingPaise,
      totalPaise: order.totalPaise,
      paymentExpiresAt: order.paymentExpiresAt.toISOString(),
      channel: order.channel,
      createdAt: order.createdAt.toISOString(),
      creator: { displayName: order.creator.displayName, slug: order.creator.slug },
      items: order.items.map((item) => ({
        id: item.id,
        productName: item.productName,
        variantName: item.variantName,
        imageUrl: item.imageUrl,
        productType: item.productType,
        quantity: item.quantity,
        unitPricePaise: item.unitPricePaise,
        shippingPaise: item.shippingPaise,
        lineTotalPaise: item.lineTotalPaise,
        status: item.status,
        gift: item.gift
          ? {
              id: item.gift.id,
              status: item.gift.status,
              shipment: item.gift.shipment
                ? { status: item.gift.shipment.status, carrier: item.gift.shipment.carrier, trackingRef: item.gift.shipment.trackingRef }
                : null,
            }
          : null,
      })),
    };
  }

  private phone(input: string) {
    try {
      return normalizePhone(input);
    } catch {
      throw badRequest('INVALID_PHONE', 'Enter a valid mobile number.');
    }
  }
}
