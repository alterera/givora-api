import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { CashfreeProvider } from '../payments/cashfree/cashfree.provider.js';
import { badRequest, notFound } from '../common/http.js';
import { randomToken } from '../domain/tokens.js';
import { coveredDates, endOfIstDay, istDateKey, shiftIstDate, weekCells } from './streak.calendar.js';

@Injectable()
export class StreakService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreeProvider,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  private pricePaise() {
    return this.config.get('STREAK_DAY_PRICE_PAISE', { infer: true });
  }

  async status(fanId: string, slug: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { slug } });
    if (!creator || creator.status !== 'APPROVED') throw notFound();
    const streak = await this.prisma.creatorStreak.findUnique({
      where: { fanId_creatorId: { fanId, creatorId: creator.id } },
    });
    return this.present(streak, creator.displayName);
  }

  async checkout(fanId: string, slug: string, channel?: string, phone?: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { slug } });
    if (!creator || creator.status !== 'APPROVED') throw notFound();
    if (creator.userId === fanId) {
      throw badRequest('OWN_WISHLIST', 'Streaks are kept with another creator.');
    }

    const today = istDateKey();
    const existing = await this.prisma.creatorStreak.findUnique({
      where: { fanId_creatorId: { fanId, creatorId: creator.id } },
    });
    if (existing?.lastPaidOn === today && existing.activeUntil && existing.activeUntil.getTime() > Date.now()) {
      throw badRequest('STREAK_ACTIVE', 'Today’s streak with this creator is already active.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: fanId } });
    const customerPhone = phone?.trim() || user?.phone;
    if (!customerPhone) throw badRequest('PHONE_REQUIRED', 'Add a phone number before purchasing a streak day.');

    const amountPaise = this.pricePaise();
    const providerCode = `GVS_${randomToken(10)}`;
    const web = this.config.get('PUBLIC_WEB_URL', { infer: true });
    const purchase = await this.prisma.streakPurchase.create({
      data: {
        fanId,
        creatorId: creator.id,
        providerOrderId: providerCode,
        amountPaise,
        status: 'PENDING_PAYMENT',
      },
    });
    const order = await this.cashfree.createOrder({
      orderId: providerCode,
      amountPaise,
      currency: 'INR',
      customerId: fanId,
      customerPhone,
      customerEmail: user?.email,
      returnUrl: `${web}/tg/w/${creator.slug}?streakPurchase=${encodeURIComponent(purchase.id)}&order_id={order_id}`,
    });
    await this.prisma.streakPurchase.update({
      where: { id: purchase.id },
      data: { paymentSessionId: order.paymentSessionId },
    });
    const mode = this.config.get('CASHFREE_ENV', { infer: true });
    return {
      purchaseId: purchase.id,
      checkout: {
        sessionId: order.paymentSessionId,
        mode,
      },
    };
  }

  async purchaseStatus(fanId: string, purchaseId: string) {
    const purchase = await this.prisma.streakPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.fanId !== fanId) throw notFound();
    if (purchase.status === 'PENDING_PAYMENT') await this.reconcile(purchase.id);
    const fresh = await this.prisma.streakPurchase.findUnique({
      where: { id: purchaseId },
      include: { creator: true },
    });
    if (!fresh) throw notFound();
    const streak = await this.prisma.creatorStreak.findUnique({
      where: { fanId_creatorId: { fanId, creatorId: fresh.creatorId } },
    });
    return {
      purchaseId: fresh.id,
      status: fresh.status,
      slug: fresh.creator.slug,
      streak: this.present(streak, fresh.creator.displayName),
    };
  }

  async reconcile(purchaseId: string) {
    const purchase = await this.prisma.streakPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase || purchase.status !== 'PENDING_PAYMENT') return;
    const remote = await this.cashfree.fetchPayments(purchase.providerOrderId);
    if (remote.status === 'SUCCESS') {
      await this.confirmPaid(purchase.id, remote.paymentId);
    } else if (remote.status === 'FAILED' || remote.status === 'USER_DROPPED') {
      await this.prisma.streakPurchase.updateMany({
        where: { id: purchaseId, status: 'PENDING_PAYMENT' },
        data: { status: 'FAILED', providerPaymentId: remote.paymentId },
      });
    }
  }

  async confirmPaid(purchaseId: string, providerPaymentId: string | null) {
    const moved = await this.prisma.streakPurchase.updateMany({
      where: { id: purchaseId, status: 'PENDING_PAYMENT' },
      data: { status: 'PAID', providerPaymentId },
    });
    if (moved.count !== 1) return;
    const purchase = await this.prisma.streakPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) return;

    const today = istDateKey();
    const yesterday = shiftIstDate(today, -1);
    const current = await this.prisma.creatorStreak.findUnique({
      where: { fanId_creatorId: { fanId: purchase.fanId, creatorId: purchase.creatorId } },
    });
    const continues = current?.lastPaidOn === yesterday || current?.lastPaidOn === today;
    const days = current?.lastPaidOn === today ? current.days : continues ? (current?.days ?? 0) + 1 : 1;

    await this.prisma.creatorStreak.upsert({
      where: { fanId_creatorId: { fanId: purchase.fanId, creatorId: purchase.creatorId } },
      create: {
        fanId: purchase.fanId,
        creatorId: purchase.creatorId,
        days: 1,
        lastPaidOn: today,
        activeUntil: endOfIstDay(today),
      },
      update: {
        days,
        lastPaidOn: today,
        activeUntil: endOfIstDay(today),
      },
    });
  }

  private present(
    streak: { days: number; lastPaidOn: string | null; activeUntil: Date | null } | null,
    creatorName: string,
  ) {
    const today = istDateKey();
    const active = Boolean(
      streak?.lastPaidOn === today && streak.activeUntil && streak.activeUntil.getTime() > Date.now(),
    );
    const covered = coveredDates(streak?.lastPaidOn ?? null, streak?.days ?? 0);
    return {
      creatorName,
      days: streak?.days ?? 0,
      active,
      lastPaidOn: streak?.lastPaidOn ?? null,
      activeUntil: streak?.activeUntil?.toISOString() ?? null,
      pricePaise: this.pricePaise(),
      today,
      week: weekCells(today, covered, active),
    };
  }
}
