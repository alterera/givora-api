import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { badRequest, forbidden, notFound } from '../common/http.js';
import type { AuraLedgerType, Prisma } from '../generated/prisma/client.js';
import {
  auraFromGiftGoodsPaise,
  giftGoodsPaise,
  GOODS_MILESTONE_PAISE,
  MILESTONE_DEFS,
  tierProgress,
} from './rules.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuraService {
  private readonly logger = new Logger(AuraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        milestones: true,
        cosmeticLoadout: true,
        cosmetics: { include: { item: true } },
      },
    });
    if (!user) throw notFound();
    const progress = tierProgress(user.earnedAura);
    const equipped = await this.equippedView(user);
    return {
      earnedAura: user.earnedAura,
      tier: { id: progress.tier.id, name: progress.tier.name },
      nextTier: progress.nextTier ? { id: progress.nextTier.id, name: progress.nextTier.name, min: progress.nextTier.min } : null,
      pointsToNext: progress.pointsToNext,
      progressPercent: progress.progressPercent,
      milestones: user.milestones.map((m) => ({
        key: m.milestoneKey,
        label: MILESTONE_DEFS[m.milestoneKey]?.label ?? m.milestoneKey,
        achievedAt: m.achievedAt.toISOString(),
      })),
      equipped,
    };
  }

  async activity(userId: string, cursor?: string, take = 20) {
    const rows = await this.prisma.auraLedgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    const nextCursor = rows.length > take ? rows[take].id : null;
    return {
      items: page.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount,
        label: this.activityLabel(row),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async inviteStatus(fanId: string, slug: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { slug } });
    if (!creator || creator.status !== 'APPROVED') {
      return { eligible: false, accepted: false, creatorName: null as string | null, reward: this.inviteReward() };
    }
    if (creator.userId === fanId) {
      return { eligible: false, accepted: false, creatorName: creator.displayName, reward: this.inviteReward() };
    }
    const claim = await this.prisma.creatorInviteClaim.findUnique({
      where: { fanId_creatorId: { fanId, creatorId: creator.id } },
    });
    return {
      eligible: true,
      accepted: !!claim,
      creatorName: creator.displayName,
      reward: this.inviteReward(),
    };
  }

  async acceptInvite(fanId: string, slug: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { slug } });
    if (!creator || creator.status !== 'APPROVED') throw badRequest('INVITE_INVALID', 'This invitation is not available.');
    if (creator.userId === fanId) throw badRequest('SELF_INVITE', 'You cannot accept your own invitation.');

    const existing = await this.prisma.creatorInviteClaim.findUnique({
      where: { fanId_creatorId: { fanId, creatorId: creator.id } },
    });
    if (existing) {
      const user = await this.prisma.user.findUnique({ where: { id: fanId } });
      return { alreadyAccepted: true, earnedAura: user?.earnedAura ?? 0, awarded: 0 };
    }

    const points = this.inviteReward();
    const idempotencyKey = `invite:${fanId}:${creator.id}`;

    try {
      const earnedAura = await this.prisma.$transaction(async (tx) => {
        await tx.creatorInviteClaim.create({
          data: { fanId, creatorId: creator.id },
        });
        const result = await this.applyEntry(tx, {
          userId: fanId,
          type: 'INVITE_ACCEPTED',
          amount: points,
          idempotencyKey,
          creatorId: creator.id,
          metadata: { creatorName: creator.displayName },
        });
        return result.earnedAura;
      });
      return { alreadyAccepted: false, earnedAura, awarded: points };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const user = await this.prisma.user.findUnique({ where: { id: fanId } });
        return { alreadyAccepted: true, earnedAura: user?.earnedAura ?? 0, awarded: 0 };
      }
      throw error;
    }
  }

  async awardGiftForOrderItem(
    tx: Tx,
    buyerId: string,
    item: { id: string; unitPricePaise: number; quantity: number; productName: string },
    creatorProfileId: string,
  ) {
    const goodsPaise = giftGoodsPaise(item.unitPricePaise, item.quantity);
    const amount = auraFromGiftGoodsPaise(goodsPaise, this.paisePerPoint());
    if (amount <= 0) return;

    const idempotencyKey = `gift:${item.id}`;
    const applied = await this.applyEntry(tx, {
      userId: buyerId,
      type: 'GIFT_PAID',
      amount,
      idempotencyKey,
      creatorId: creatorProfileId,
      orderItemId: item.id,
      metadata: { goodsPaise, productName: item.productName },
    });
    if (applied.created) {
      await this.evaluateMilestones(tx, buyerId);
    }
  }

  async reverseGiftForRefund(refundId: string, orderItemId: string) {
    const giftEntry = await this.prisma.auraLedgerEntry.findFirst({
      where: { type: 'GIFT_PAID', orderItemId },
    });
    if (!giftEntry || giftEntry.amount <= 0) return;

    const idempotencyKey = `refund:${refundId}`;
    const existing = await this.prisma.auraLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (existing) return;

    await this.prisma.$transaction(async (tx) => {
      await this.applyEntry(tx, {
        userId: giftEntry.userId,
        type: 'REFUND_REVERSAL',
        amount: -giftEntry.amount,
        idempotencyKey,
        orderItemId,
        refundId,
        metadata: {
          reversedAmount: giftEntry.amount,
          goodsPaise: (giftEntry.metadata as { goodsPaise?: number })?.goodsPaise ?? null,
        },
      });
    });
  }

  async adminAdjust(actorId: string, userId: string, amount: number, reason: string, idempotencyKey: string) {
    if (!idempotencyKey || amount === 0) throw badRequest('INVALID_ADJUSTMENT', 'Provide a non-zero amount and idempotency key.');
    const earnedAura = await this.prisma.$transaction(async (tx) => {
      const result = await this.applyEntry(tx, {
        userId,
        type: 'ADMIN_ADJUSTMENT',
        amount,
        idempotencyKey: `admin:${idempotencyKey}`,
        metadata: { reason, actorId },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'aura.adjust',
          entity: 'User',
          entityId: userId,
          metadata: { amount, reason, idempotencyKey },
        },
      });
      return result.earnedAura;
    });
    return { earnedAura };
  }

  async supporterView(buyerUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: buyerUserId } });
    if (!user) return { earnedAura: 0, tier: { id: 'spark', name: 'Spark' } };
    const progress = tierProgress(user.earnedAura);
    const equipped = await this.equippedForUser(buyerUserId);
    return {
      earnedAura: user.earnedAura,
      tier: { id: progress.tier.id, name: progress.tier.name },
      equipped,
    };
  }

  private async equippedForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        cosmeticLoadout: true,
        cosmetics: { include: { item: true } },
      },
    });
    if (!user) return null;
    return this.equippedView(user);
  }

  private async equippedView(user: {
    cosmeticLoadout: { frameItemId: string | null; effectItemId: string | null } | null;
    cosmetics: Array<{ itemId: string; item: { slug: string; kind: string; cssClass: string | null; name: string } }>;
  }) {
    const owned = new Map(user.cosmetics.map((c) => [c.itemId, c.item]));
    const loadout = user.cosmeticLoadout;
    const frame = loadout?.frameItemId ? owned.get(loadout.frameItemId) : null;
    const effect = loadout?.effectItemId ? owned.get(loadout.effectItemId) : null;
    if (!frame && !effect) return null;
    return {
      frame: frame ? { slug: frame.slug, name: frame.name, cssClass: frame.cssClass } : null,
      effect: effect ? { slug: effect.slug, name: effect.name, cssClass: effect.cssClass } : null,
    };
  }

  private async evaluateMilestones(tx: Tx, userId: string) {
    const existing = await tx.userMilestone.findMany({ where: { userId } });
    const keys = new Set(existing.map((m) => m.milestoneKey));

    if (!keys.has('FIRST_GIFT')) {
      await this.grantMilestone(tx, userId, 'FIRST_GIFT');
    }

    if (!keys.has('THREE_CREATORS')) {
      const giftRows = await tx.auraLedgerEntry.findMany({
        where: { userId, type: 'GIFT_PAID', amount: { gt: 0 } },
        select: { creatorId: true },
      });
      const creators = new Set(giftRows.map((r) => r.creatorId).filter(Boolean));
      if (creators.size >= 3) {
        await this.grantMilestone(tx, userId, 'THREE_CREATORS');
      }
    }

    if (!keys.has('GOODS_1000')) {
      const netGoods = await this.netGiftGoodsPaise(tx, userId);
      if (netGoods >= GOODS_MILESTONE_PAISE) {
        await this.grantMilestone(tx, userId, 'GOODS_1000');
      }
    }
  }

  private async netGiftGoodsPaise(tx: Tx, userId: string) {
    const entries = await tx.auraLedgerEntry.findMany({
      where: { userId, type: { in: ['GIFT_PAID', 'REFUND_REVERSAL'] } },
      select: { type: true, metadata: true },
    });
    let total = 0;
    for (const row of entries) {
      const goods = (row.metadata as { goodsPaise?: number })?.goodsPaise ?? 0;
      if (row.type === 'GIFT_PAID') total += goods;
      if (row.type === 'REFUND_REVERSAL') total -= goods;
    }
    return Math.max(0, total);
  }

  private async grantMilestone(tx: Tx, userId: string, milestoneKey: string) {
    const def = MILESTONE_DEFS[milestoneKey];
    if (!def) return;
    const idempotencyKey = `milestone:${userId}:${milestoneKey}`;
    const existing = await tx.auraLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (existing) return;

    const entry = await tx.auraLedgerEntry.create({
      data: {
        userId,
        type: 'MILESTONE',
        amount: def.points,
        idempotencyKey,
        milestoneKey,
        metadata: { label: def.label },
      },
    });
    await this.bumpCache(tx, userId, def.points);
    await tx.userMilestone.create({
      data: { userId, milestoneKey, ledgerEntryId: entry.id },
    });
  }

  private async applyEntry(
    tx: Tx,
    input: {
      userId: string;
      type: AuraLedgerType;
      amount: number;
      idempotencyKey: string;
      creatorId?: string;
      orderItemId?: string;
      refundId?: string;
      milestoneKey?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<{ created: boolean; earnedAura: number }> {
    const dup = await tx.auraLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) {
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      return { created: false, earnedAura: user?.earnedAura ?? 0 };
    }
    await tx.auraLedgerEntry.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
        creatorId: input.creatorId,
        orderItemId: input.orderItemId,
        refundId: input.refundId,
        milestoneKey: input.milestoneKey,
        metadata: input.metadata,
      },
    });
    const earnedAura = await this.bumpCache(tx, input.userId, input.amount);
    return { created: true, earnedAura };
  }

  private async bumpCache(tx: Tx, userId: string, delta: number) {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { earnedAura: { increment: delta } },
    });
    if (updated.earnedAura < 0) {
      this.logger.warn(`Aura cache clamped for user ${userId}`);
      await tx.user.update({ where: { id: userId }, data: { earnedAura: 0 } });
      return 0;
    }
    return updated.earnedAura;
  }

  private activityLabel(row: {
    type: string;
    metadata: unknown;
    amount: number;
  }) {
    const meta = row.metadata as { creatorName?: string; productName?: string; label?: string; reason?: string };
    switch (row.type) {
      case 'INVITE_ACCEPTED':
        return meta.creatorName ? `Joined ${meta.creatorName}'s circle` : 'Creator invitation accepted';
      case 'GIFT_PAID':
        return meta.productName ? `Gifted ${meta.productName}` : 'Gift purchase';
      case 'MILESTONE':
        return meta.label ?? 'Milestone reached';
      case 'REFUND_REVERSAL':
        return 'Gift refund adjustment';
      case 'ADMIN_ADJUSTMENT':
        return meta.reason ?? 'Aura adjustment';
      default:
        return 'Aura update';
    }
  }

  private inviteReward() {
    return this.config.get('AURA_INVITE_POINTS', { infer: true });
  }

  private paisePerPoint() {
    return this.config.get('AURA_PAISE_PER_POINT', { infer: true });
  }

  private isUniqueViolation(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    );
  }
}
