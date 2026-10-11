import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { OtpService } from '../otp/otp.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { normalizePhone, phonesMatch } from '../domain/phone.js';
import { orderNumber, sha256 } from '../domain/tokens.js';
import type { ClaimDto } from './redemptions.dto.js';

@Injectable()
export class RedemptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationsService,
  ) {}

  async reveal(token: string) {
    const gift = await this.findByToken(token);
    return this.safeView(gift);
  }

  async markOpened(token: string) {
    const gift = await this.findByToken(token);
    if (gift.status !== 'READY_TO_SEND' || gift.openedAt) return { ok: true };
    await this.prisma.gift.update({
      where: { id: gift.id },
      data: { openedAt: new Date() },
    });
    await this.prisma.giftEvent.create({
      data: { giftId: gift.id, type: 'OPENED' },
    });
    const sender = gift.sender;
    const name = gift.recipientNameHint || 'Someone';
    if (sender.phone) {
      await this.notifications.sendWhatsAppText(sender.phone, 'givora_gift_opened', [name]);
    }
    if (sender.email) {
      await this.notifications.sendEmail(
        sender.email,
        'Your gift was opened',
        `${name} opened the gift you sent on Givora.`,
      );
    }
    return { ok: true };
  }

  async requestClaimOtp(token: string, phoneInput?: string) {
    const gift = await this.findByToken(token);
    this.assertClaimable(gift);
    const phone = gift.recipientPhone ?? this.phone(phoneInput);
    if (!phone) throw badRequest('PHONE_REQUIRED', 'Enter the mobile number to verify.');
    if (gift.recipientPhone && phoneInput && !phonesMatch(gift.recipientPhone, phoneInput)) {
      throw badRequest('PHONE_MISMATCH', 'Use the mobile number this gift was sent to.');
    }
    const code = await this.otp.issue(phone, 'claim', gift.id);
    await this.notifications.sendOtp(phone, code);
    return { sent: true, phoneHint: `${phone.slice(0, 3)}••••${phone.slice(-2)}` };
  }

  async verifyClaimOtp(token: string, phoneInput: string, code: string) {
    const gift = await this.findByToken(token);
    this.assertClaimable(gift);
    const phone = this.phone(phoneInput);
    if (gift.recipientPhone && !phonesMatch(gift.recipientPhone, phone)) {
      throw badRequest('PHONE_MISMATCH', 'Use the mobile number this gift was sent to.');
    }
    await this.otp.consume(phone, 'claim', code, gift.id);
    const claimTicket = await this.auth.signClaimTicket(gift.id, phone);
    return { claimTicket };
  }

  async claim(token: string, dto: ClaimDto) {
    const gift = await this.findByToken(token);
    this.assertClaimable(gift);
    const phone = await this.auth.readClaimTicket(dto.claimTicket, gift.id);
    if (gift.recipientPhone && !phonesMatch(gift.recipientPhone, phone)) {
      throw badRequest('PHONE_MISMATCH', 'This gift is reserved for another number.');
    }
    if (dto.address.countryCode !== 'IN' || !/^\d{6}$/.test(dto.address.postalCode)) {
      throw badRequest('ADDRESS_INVALID', 'Use an Indian PIN code for delivery.');
    }
    const orderNo = orderNumber();
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const moved = await tx.gift.updateMany({
          where: {
            id: gift.id,
            status: 'READY_TO_SEND',
            claimExpiresAt: { gt: new Date() },
          },
          data: { status: 'CLAIMED', claimedAt: new Date() },
        });
        if (moved.count !== 1) throw conflict('GIFT_UNAVAILABLE', 'This gift can no longer be claimed.');
        const claim = await tx.claim.create({
          data: {
            giftId: gift.id,
            recipientName: dto.recipientName.trim(),
            phone,
            phoneVerifiedAt: new Date(),
            address: {
              create: {
                line1: dto.address.line1.trim(),
                line2: dto.address.line2?.trim() ?? '',
                city: dto.address.city.trim(),
                state: dto.address.state.trim(),
                postalCode: dto.address.postalCode,
                countryCode: 'IN',
              },
            },
          },
        });
        const order = await tx.fulfilmentOrder.create({
          data: {
            giftId: gift.id,
            orderNumber: orderNo,
            status: 'PLACED',
            events: { create: { toStatus: 'PLACED', note: 'Recipient claimed the gift' } },
          },
        });
        await tx.giftEvent.create({
          data: { giftId: gift.id, type: 'CLAIMED', fromStatus: 'READY_TO_SEND', toStatus: 'CLAIMED' },
        });
        return { claimId: claim.id, orderNumber: order.orderNumber };
      });
      if (gift.sender.phone) {
        await this.notifications.sendWhatsAppText(gift.sender.phone, 'givora_gift_claimed', [
          dto.recipientName.trim(),
        ]);
      }
      if (gift.sender.email) {
        await this.notifications.sendEmail(
          gift.sender.email,
          'Your gift was claimed',
          `${dto.recipientName.trim()} claimed the gift and added a delivery address.`,
        );
      }
      return {
        claimed: true,
        orderNumber: result.orderNumber,
        recipientName: dto.recipientName.trim(),
      };
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      const again = await this.prisma.gift.findUnique({ where: { id: gift.id } });
      if (again?.status === 'CLAIMED') {
        throw conflict('ALREADY_CLAIMED', 'This gift has already been claimed.');
      }
      throw error;
    }
  }

  async claimStatus(token: string) {
    const gift = await this.findByToken(token);
    return {
      status: gift.status,
      claimed: gift.status === 'CLAIMED' || gift.status === 'REFUNDED',
      orderNumber: gift.fulfilment?.orderNumber ?? null,
      fulfilmentStatus: gift.fulfilment?.status ?? null,
    };
  }

  private assertClaimable(gift: { status: string; claimExpiresAt: Date | null }) {
    if (gift.status === 'CLAIMED') throw conflict('ALREADY_CLAIMED', 'This gift has already been claimed.');
    if (gift.status === 'EXPIRED') throw badRequest('GIFT_EXPIRED', 'This gift has expired.');
    if (gift.status === 'REVOKED' || gift.status === 'REFUNDED' || gift.status === 'CANCELLED') {
      throw badRequest('GIFT_UNAVAILABLE', 'This gift is no longer available.');
    }
    if (gift.status !== 'READY_TO_SEND') {
      throw badRequest('GIFT_NOT_READY', 'This gift is not ready yet.');
    }
    if (gift.claimExpiresAt && gift.claimExpiresAt.getTime() < Date.now()) {
      throw badRequest('GIFT_EXPIRED', 'This gift has expired.');
    }
  }

  private async findByToken(token: string) {
    const gift = await this.prisma.gift.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        items: true,
        sender: true,
        fulfilment: true,
      },
    });
    if (!gift) throw notFound('This gift link is not valid.');
    return gift;
  }

  private safeView(gift: {
    status: string;
    message: string;
    senderDisplayName: string;
    isAnonymous: boolean;
    revealTheme: string;
    recipientNameHint: string | null;
    recipientPhone: string | null;
    claimExpiresAt: Date | null;
    items: Array<{
      productName: string;
      variantName: string;
      imageUrl: string | null;
      quantity: number;
    }>;
    fulfilment: { orderNumber: string; status: string } | null;
  }) {
    const locked = gift.status === 'PAYMENT_PENDING' || gift.status === 'CANCELLED';
    if (locked) throw notFound('This gift link is not valid.');
    return {
      status: gift.status,
      message: gift.message,
      from: gift.isAnonymous ? 'Someone special' : gift.senderDisplayName,
      theme: gift.revealTheme,
      recipientNameHint: gift.recipientNameHint,
      phoneLocked: Boolean(gift.recipientPhone),
      claimExpiresAt: gift.claimExpiresAt?.toISOString() ?? null,
      items: gift.items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
      })),
      fulfilmentStatus: gift.fulfilment?.status ?? null,
    };
  }

  private phone(input?: string): string {
    if (!input) throw badRequest('PHONE_REQUIRED', 'Enter the mobile number to verify.');
    try {
      return normalizePhone(input);
    } catch {
      throw badRequest('INVALID_PHONE', 'Enter a valid mobile number.');
    }
  }
}
