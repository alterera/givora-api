import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { CashfreeProvider } from '../payments/cashfree/cashfree.provider.js';
import { badRequest, forbidden, notFound } from '../common/http.js';
import { randomToken } from '../domain/tokens.js';

@Injectable()
export class CosmeticsService {
  private readonly logger = new Logger(CosmeticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreeProvider,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async catalogue(userId: string) {
    const items = await this.prisma.cosmeticItem.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const owned = await this.prisma.userCosmetic.findMany({ where: { userId } });
    const ownedIds = new Set(owned.map((o) => o.itemId));
    const loadout = await this.prisma.userCosmeticLoadout.findUnique({ where: { userId } });
    return {
      items: items.map((item) => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        description: item.description,
        kind: item.kind,
        pricePaise: item.pricePaise,
        previewUrl: item.previewUrl,
        cssClass: item.cssClass,
        owned: ownedIds.has(item.id),
        equipped:
          loadout?.frameItemId === item.id || loadout?.effectItemId === item.id,
      })),
    };
  }

  async checkout(userId: string, slug: string, channel?: string, phone?: string) {
    const item = await this.prisma.cosmeticItem.findUnique({ where: { slug, active: true } });
    if (!item) throw notFound();
    const owned = await this.prisma.userCosmetic.findUnique({
      where: { userId_itemId: { userId, itemId: item.id } },
    });
    if (owned) throw badRequest('ALREADY_OWNED', 'You already own this cosmetic.');

    if (item.pricePaise === 0) {
      await this.grantOwnership(userId, item.id, 'free');
      return { free: true, slug: item.slug };
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const customerPhone = phone?.trim() || user?.phone;
    if (!customerPhone) throw badRequest('PHONE_REQUIRED', 'Add a phone number before purchasing.');

    const providerCode = `GVC_${randomToken(10)}`;
    const web = this.config.get('PUBLIC_WEB_URL', { infer: true });
    const returnPath = channel === 'telegram' ? '/tg/profile/studio/return' : '/account';
    const purchase = await this.prisma.cosmeticPurchase.create({
      data: {
        userId,
        itemId: item.id,
        providerOrderId: providerCode,
        amountPaise: item.pricePaise,
        status: 'PENDING_PAYMENT',
      },
    });
    const order = await this.cashfree.createOrder({
      orderId: providerCode,
      amountPaise: item.pricePaise,
      currency: 'INR',
      customerId: userId,
      customerPhone,
      customerEmail: user?.email,
      returnUrl: `${web}${returnPath}?purchaseId=${encodeURIComponent(purchase.id)}&order_id={order_id}`,
    });
    await this.prisma.cosmeticPurchase.update({
      where: { id: purchase.id },
      data: { paymentSessionId: order.paymentSessionId },
    });

    const mode = this.config.get('CASHFREE_ENV', { infer: true });
    return {
      purchaseId: purchase.id,
      checkout: {
        sessionId: order.paymentSessionId,
        mode,
        hostedUrl: this.cashfree.hostedCheckoutUrl(order.paymentSessionId!, purchase.id),
      },
    };
  }

  async purchaseStatus(userId: string, purchaseId: string) {
    const purchase = await this.prisma.cosmeticPurchase.findUnique({
      where: { id: purchaseId },
      include: { item: true },
    });
    if (!purchase || purchase.userId !== userId) throw notFound();
    if (purchase.status === 'PENDING_PAYMENT') {
      await this.reconcilePurchase(purchase.id);
    }
    const fresh = await this.prisma.cosmeticPurchase.findUnique({
      where: { id: purchaseId },
      include: { item: true },
    });
    if (!fresh) throw notFound();
    return {
      purchaseId: fresh.id,
      status: fresh.status,
      itemSlug: fresh.item.slug,
      owned: fresh.status === 'PAID',
    };
  }

  async reconcilePurchase(purchaseId: string) {
    const purchase = await this.prisma.cosmeticPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.status !== 'PENDING_PAYMENT') return;
    const remote = await this.cashfree.fetchPayments(purchase.providerOrderId);
    if (remote.status === 'SUCCESS') {
      await this.confirmPaid(purchase.id, remote.paymentId);
    } else if (remote.status === 'FAILED' || remote.status === 'USER_DROPPED') {
      await this.prisma.cosmeticPurchase.updateMany({
        where: { id: purchaseId, status: 'PENDING_PAYMENT' },
        data: { status: 'FAILED', providerPaymentId: remote.paymentId },
      });
    }
  }

  async confirmPaid(purchaseId: string, providerPaymentId: string | null) {
    const moved = await this.prisma.cosmeticPurchase.updateMany({
      where: { id: purchaseId, status: 'PENDING_PAYMENT' },
      data: { status: 'PAID', providerPaymentId },
    });
    if (moved.count !== 1) return;
    const purchase = await this.prisma.cosmeticPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) return;
    await this.grantOwnership(purchase.userId, purchase.itemId, 'purchase');
  }

  async equip(userId: string, slug: string) {
    const item = await this.prisma.cosmeticItem.findUnique({ where: { slug, active: true } });
    if (!item) throw notFound();
    const owned = await this.prisma.userCosmetic.findUnique({
      where: { userId_itemId: { userId, itemId: item.id } },
    });
    if (!owned) throw forbidden();

    const data: { frameItemId?: string | null; effectItemId?: string | null } = {};
    if (item.kind === 'FRAME') data.frameItemId = item.id;
    else if (item.kind === 'EFFECT') data.effectItemId = item.id;
    else throw badRequest('NOT_EQUIPPABLE', 'This cosmetic cannot be equipped in a loadout slot.');

    await this.prisma.userCosmeticLoadout.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return { ok: true };
  }

  async unequip(userId: string, kind: 'FRAME' | 'EFFECT') {
    const loadout = await this.prisma.userCosmeticLoadout.findUnique({ where: { userId } });
    if (!loadout) return { ok: true };
    const data =
      kind === 'FRAME' ? { frameItemId: null } : kind === 'EFFECT' ? { effectItemId: null } : {};
    await this.prisma.userCosmeticLoadout.update({ where: { userId }, data });
    return { ok: true };
  }

  async grantOwnership(userId: string, itemId: string, source: string) {
    await this.prisma.userCosmetic.upsert({
      where: { userId_itemId: { userId, itemId } },
      create: { userId, itemId, source },
      update: {},
    });
  }

  async adminListItems() {
    const items = await this.prisma.cosmeticItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { owners: true, purchases: true } },
      },
    });
    return items.map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      description: item.description,
      kind: item.kind,
      pricePaise: item.pricePaise,
      active: item.active,
      sortOrder: item.sortOrder,
      ownerCount: item._count.owners,
      purchaseCount: item._count.purchases,
    }));
  }

  async adminListPurchases(take = 50) {
    const rows = await this.prisma.cosmeticPurchase.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        item: { select: { slug: true, name: true } },
        user: { select: { id: true, displayName: true, telegramUsername: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      amountPaise: row.amountPaise,
      providerOrderId: row.providerOrderId,
      createdAt: row.createdAt.toISOString(),
      item: row.item,
      user: {
        id: row.user.id,
        displayName: row.user.displayName,
        telegramUsername: row.user.telegramUsername,
      },
    }));
  }

  async revokePurchase(purchaseId: string) {
    const purchase = await this.prisma.cosmeticPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.status !== 'PAID') throw badRequest('NOT_REVOKABLE', 'Only a paid cosmetic purchase can be revoked.');
    await this.prisma.$transaction(async (tx) => {
      await tx.cosmeticPurchase.update({ where: { id: purchaseId }, data: { status: 'REFUNDED' } });
      await tx.userCosmetic.deleteMany({ where: { userId: purchase.userId, itemId: purchase.itemId } });
      const loadout = await tx.userCosmeticLoadout.findUnique({ where: { userId: purchase.userId } });
      if (loadout) {
        await tx.userCosmeticLoadout.update({
          where: { userId: purchase.userId },
          data: {
            frameItemId: loadout.frameItemId === purchase.itemId ? null : loadout.frameItemId,
            effectItemId: loadout.effectItemId === purchase.itemId ? null : loadout.effectItemId,
          },
        });
      }
    });
    return { ok: true };
  }

  async seedDefaults() {
    const defaults = [
      {
        slug: 'frame-spark',
        name: 'Spark Frame',
        description: 'A soft glow for new supporters.',
        kind: 'FRAME' as const,
        pricePaise: 0,
        cssClass: 'aura-frame-spark',
        sortOrder: 1,
      },
      {
        slug: 'frame-rose',
        name: 'Rose Halo',
        description: 'Premium profile frame. Cosmetic only — does not change your earned Aura rank.',
        kind: 'FRAME' as const,
        pricePaise: 7900,
        cssClass: 'aura-frame-rose',
        sortOrder: 2,
      },
      {
        slug: 'frame-gold',
        name: 'Golden Orbit',
        description: 'Premium profile frame. Cosmetic only.',
        kind: 'FRAME' as const,
        pricePaise: 9900,
        cssClass: 'aura-frame-gold',
        sortOrder: 3,
      },
      {
        slug: 'effect-shimmer',
        name: 'Shimmer Pulse',
        description: 'Subtle aura shimmer on your profile.',
        kind: 'EFFECT' as const,
        pricePaise: 14900,
        cssClass: 'aura-effect-shimmer',
        sortOrder: 4,
      },
    ];
    for (const item of defaults) {
      await this.prisma.cosmeticItem.upsert({
        where: { slug: item.slug },
        create: item,
        update: {
          name: item.name,
          description: item.description,
          pricePaise: item.pricePaise,
          cssClass: item.cssClass,
          sortOrder: item.sortOrder,
          active: true,
        },
      });
    }
  }
}
