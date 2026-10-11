import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { badRequest, forbidden, notFound } from '../common/http.js';
import { shippingPaise } from '../domain/money.js';
import { normalizePhone } from '../domain/phone.js';
import { publicRef, randomToken, sha256 } from '../domain/tokens.js';
import type { CheckoutDto, CreateGiftDto, PatchGiftDto } from './gifts.dto.js';
import { senderGiftView } from './gift.presenter.js';

const giftInclude = {
  items: true,
  events: { orderBy: { createdAt: 'asc' as const } },
  fulfilment: true,
};

@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async create(senderId: string, dto: CreateGiftDto) {
    const phone = dto.recipientPhone ? this.phone(dto.recipientPhone) : null;
    const minutes = this.config.get('PAYMENT_WINDOW_MINUTES', { infer: true });
    const paymentExpiresAt = new Date(Date.now() + minutes * 60 * 1000);
    const gift = await this.prisma.$transaction(async (tx) => {
      const priced = await this.price(tx, dto.items);
      const created = await tx.gift.create({
        data: {
          publicRef: publicRef(),
          senderId,
          message: dto.message.trim(),
          senderDisplayName: dto.senderDisplayName.trim(),
          isAnonymous: dto.isAnonymous,
          revealTheme: dto.revealTheme,
          recipientNameHint: dto.recipientNameHint?.trim(),
          recipientPhone: phone,
          subtotalPaise: priced.subtotalPaise,
          shippingPaise: priced.shippingPaise,
          totalPaise: priced.totalPaise,
          paymentExpiresAt,
          items: {
            create: priced.lines,
          },
        },
        include: giftInclude,
      });
      for (const line of priced.lines) {
        await this.inventory.reserve(tx, line.variantId, line.quantity);
        await tx.inventoryReservation.create({
          data: {
            giftId: created.id,
            variantId: line.variantId,
            quantity: line.quantity,
            expiresAt: paymentExpiresAt,
          },
        });
      }
      await tx.giftEvent.create({
        data: { giftId: created.id, type: 'CREATED', toStatus: 'PAYMENT_PENDING' },
      });
      return created;
    });
    return senderGiftView(gift);
  }

  async getOwned(senderId: string, id: string) {
    const gift = await this.owned(senderId, id);
    return senderGiftView(gift);
  }

  async listOwned(senderId: string) {
    const gifts = await this.prisma.gift.findMany({
      where: { senderId },
      include: giftInclude,
      orderBy: { createdAt: 'desc' },
    });
    return gifts.map(senderGiftView);
  }

  async patch(senderId: string, id: string, dto: PatchGiftDto) {
    const gift = await this.owned(senderId, id);
    if (gift.status !== 'PAYMENT_PENDING') {
      throw badRequest('GIFT_LOCKED', 'This gift can no longer be edited.');
    }
    const updated = await this.prisma.gift.update({
      where: { id },
      data: {
        message: dto.message?.trim(),
        senderDisplayName: dto.senderDisplayName?.trim(),
        isAnonymous: dto.isAnonymous,
        revealTheme: dto.revealTheme,
        recipientNameHint: dto.recipientNameHint?.trim(),
        recipientPhone: dto.recipientPhone ? this.phone(dto.recipientPhone) : undefined,
      },
      include: giftInclude,
    });
    return senderGiftView(updated);
  }

  async share(senderId: string, id: string) {
    const gift = await this.owned(senderId, id);
    if (gift.status !== 'READY_TO_SEND' && gift.status !== 'CLAIMED') {
      throw badRequest('GIFT_NOT_READY', 'The gift link is available after payment is confirmed.');
    }
    if (gift.status === 'CLAIMED') {
      throw badRequest('GIFT_CLAIMED', 'This gift has already been claimed.');
    }
    const token = randomToken(32);
    await this.prisma.gift.update({
      where: { id: gift.id },
      data: { tokenHash: sha256(token) },
    });
    const url = `${this.config.get('PUBLIC_WEB_URL', { infer: true })}/g/${token}`;
    return {
      url,
      rotated: true,
      message: 'A new link was created. Earlier links no longer work.',
    };
  }

  async status(senderId: string, id: string) {
    return this.getOwned(senderId, id);
  }

  async extend(senderId: string, id: string) {
    const gift = await this.owned(senderId, id);
    if (gift.status !== 'READY_TO_SEND' || !gift.claimExpiresAt) {
      throw badRequest('GIFT_NOT_EXTENDABLE', 'Only an unclaimed gift can be extended.');
    }
    if (gift.extensionCount >= 1) {
      throw badRequest('EXTENSION_USED', 'This gift was already extended once.');
    }
    const days = this.config.get('CLAIM_EXTENSION_DAYS', { infer: true });
    const claimExpiresAt = new Date(gift.claimExpiresAt.getTime() + days * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.gift.update({
      where: { id },
      data: { claimExpiresAt, extensionCount: { increment: 1 } },
      include: giftInclude,
    });
    await this.prisma.giftEvent.create({
      data: { giftId: id, type: 'EXTENDED', metadata: { claimExpiresAt: claimExpiresAt.toISOString() } },
    });
    return senderGiftView(updated);
  }

  async prepareCheckout(senderId: string, id: string, dto: CheckoutDto) {
    const gift = await this.owned(senderId, id);
    if (gift.status !== 'PAYMENT_PENDING') {
      throw badRequest('GIFT_NOT_PAYABLE', 'This gift is not waiting for payment.');
    }
    if (gift.paymentExpiresAt.getTime() < Date.now()) {
      throw badRequest('GIFT_EXPIRED', 'The payment window closed. Start the gift again.');
    }
    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId } });
    let phone = sender.phone;
    if (!phone && dto.phone) {
      phone = this.phone(dto.phone);
      await this.prisma.user.update({ where: { id: senderId }, data: { phone } });
    }
    if (!phone) throw badRequest('PHONE_REQUIRED', 'Add a mobile number to pay.');
    const attempt = gift.checkoutAttempt + 1;
    await this.prisma.gift.update({ where: { id }, data: { checkoutAttempt: attempt } });
    return {
      gift,
      phone,
      email: sender.email,
      orderId: `${gift.publicRef}_${attempt}`,
    };
  }

  private async owned(senderId: string, id: string) {
    const gift = await this.prisma.gift.findUnique({ where: { id }, include: giftInclude });
    if (!gift) throw notFound();
    if (gift.senderId !== senderId) throw forbidden();
    return gift;
  }

  private async price(
    tx: PrismaService | Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    items: Array<{ variantId: string; quantity: number }>,
  ) {
    const lines = [];
    let subtotalPaise = 0;
    for (const item of items) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
      });
      if (!variant || !variant.isActive || variant.product.status !== 'ACTIVE') {
        throw badRequest('VARIANT_UNAVAILABLE', 'One of the gifts is no longer available.');
      }
      const lineTotalPaise = variant.pricePaise * item.quantity;
      subtotalPaise += lineTotalPaise;
      lines.push({
        variantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name,
        imageUrl: variant.product.images[0]?.url ?? null,
        quantity: item.quantity,
        unitPricePaise: variant.pricePaise,
        lineTotalPaise,
      });
    }
    const ship = shippingPaise(
      subtotalPaise,
      this.config.get('SHIPPING_FLAT_PAISE', { infer: true }),
      this.config.get('SHIPPING_FREE_ABOVE_PAISE', { infer: true }),
    );
    return { lines, subtotalPaise, shippingPaise: ship, totalPaise: subtotalPaise + ship };
  }

  private phone(input: string) {
    try {
      return normalizePhone(input);
    } catch {
      throw badRequest('INVALID_PHONE', 'Enter a valid mobile number.');
    }
  }
}
