import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { TelegramSender } from '../telegram/telegram.sender.js';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly telegram: TelegramSender,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    const locked = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(814270) AS locked`;
    if (!locked[0]?.locked) return;
    try {
      await this.expireUnpaid();
      await this.remind();
      await this.expireGifts();
      await this.reconcilePending();
    } catch (error) {
      this.logger.error(error);
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(814270)`;
    }
  }

  async expireUnpaid() {
    const orders = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', paymentExpiresAt: { lt: new Date() } },
    });
    for (const order of orders) {
      await this.prisma.order.updateMany({
        where: { id: order.id, status: 'PENDING_PAYMENT' },
        data: { status: 'EXPIRED' },
      });
    }
  }

  async remind() {
    const days = this.config.get('GIFT_REMINDER_DAYS', { infer: true });
    const soon = new Date(Date.now() + days * 86_400_000);
    const gifts = await this.prisma.gift.findMany({
      where: { status: 'AWAITING_REDEMPTION', remindedAt: null, expiresAt: { lt: soon, gt: new Date() } },
      include: { recipient: true, orderItem: true },
    });
    for (const gift of gifts) {
      await this.telegram.notifyUser(gift.recipient, `Your gift ${gift.orderItem.productName} expires soon. Open GivoraWorld to redeem it.`, `g_${gift.id}`);
      await this.prisma.gift.update({ where: { id: gift.id }, data: { remindedAt: new Date() } });
    }
  }

  async expireGifts() {
    const gifts = await this.prisma.gift.findMany({
      where: { status: 'AWAITING_REDEMPTION', expiresAt: { lt: new Date() } },
      include: { orderItem: { include: { reservation: true, order: { include: { payments: true } } } } },
    });
    for (const gift of gifts) {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.gift.updateMany({
          where: { id: gift.id, status: 'AWAITING_REDEMPTION' },
          data: { status: 'EXPIRED', needsRefund: true },
        });
        if (moved.count !== 1) return;
        if (gift.orderItem.reservation?.status === 'ACTIVE') {
          await this.inventory.release(tx, gift.orderItem.variantId, gift.orderItem.quantity);
          await tx.inventoryReservation.update({ where: { id: gift.orderItem.reservation.id }, data: { status: 'RELEASED' } });
        }
        await tx.giftEvent.create({ data: { giftId: gift.id, type: 'EXPIRED', toStatus: 'EXPIRED' } });
      });
      const paid = gift.orderItem.order.payments.find((payment) => payment.status === 'PAID');
      if (paid) {
        await this.payments.refundLine(paid.id, gift.orderItem.id, 'Unredeemed gift expired').catch((error) => this.logger.error(error));
      }
    }
  }

  async reconcilePending() {
    const stale = new Date(Date.now() - 2 * 60 * 1000);
    const payments = await this.prisma.payment.findMany({ where: { status: 'PENDING', updatedAt: { lt: stale } }, take: 50 });
    for (const payment of payments) {
      await this.payments.reconcilePayment(payment.id).catch((error) => this.logger.error(error));
    }
  }
}
