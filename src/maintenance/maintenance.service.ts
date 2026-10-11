import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentsService } from '../payments/payments.service.js';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    const locked = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(814270) AS locked
    `;
    if (!locked[0]?.locked) return;
    try {
      await this.expireUnpaid();
      await this.expireUnclaimed();
      await this.reconcilePending();
    } catch (error) {
      this.logger.error(error);
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(814270)`;
    }
  }

  async expireUnpaid() {
    const gifts = await this.prisma.gift.findMany({
      where: { status: 'PAYMENT_PENDING', paymentExpiresAt: { lt: new Date() } },
      include: { reservations: true },
    });
    for (const gift of gifts) {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.gift.updateMany({
          where: { id: gift.id, status: 'PAYMENT_PENDING' },
          data: { status: 'CANCELLED' },
        });
        if (moved.count !== 1) return;
        for (const reservation of gift.reservations.filter((row) => row.status === 'ACTIVE')) {
          await this.inventory.release(tx, reservation.variantId, reservation.quantity);
          await tx.inventoryReservation.update({
            where: { id: reservation.id },
            data: { status: 'RELEASED' },
          });
        }
        await tx.giftEvent.create({
          data: { giftId: gift.id, type: 'CANCELLED', fromStatus: 'PAYMENT_PENDING', toStatus: 'CANCELLED' },
        });
      });
    }
  }

  async expireUnclaimed() {
    const gifts = await this.prisma.gift.findMany({
      where: { status: 'READY_TO_SEND', claimExpiresAt: { lt: new Date() } },
      include: { items: true, payments: true },
    });
    for (const gift of gifts) {
      await this.prisma.$transaction(async (tx) => {
        const moved = await tx.gift.updateMany({
          where: { id: gift.id, status: 'READY_TO_SEND' },
          data: { status: 'EXPIRED', needsRefund: true },
        });
        if (moved.count !== 1) return;
        for (const item of gift.items) {
          await this.inventory.restoreCommitted(tx, item.variantId, item.quantity);
        }
        await tx.giftEvent.create({
          data: { giftId: gift.id, type: 'EXPIRED', fromStatus: 'READY_TO_SEND', toStatus: 'EXPIRED' },
        });
      });
      const paid = gift.payments.find((payment) => payment.status === 'PAID');
      if (paid) {
        await this.payments.refundPayment(paid.id, null, 'Claim window expired').catch((error) => {
          this.logger.error(error);
        });
      }
    }
  }

  async reconcilePending() {
    const stale = new Date(Date.now() - 2 * 60 * 1000);
    const payments = await this.prisma.payment.findMany({
      where: { status: 'PENDING', updatedAt: { lt: stale } },
      take: 50,
    });
    for (const payment of payments) {
      await this.payments.reconcilePayment(payment.id).catch((error) => this.logger.error(error));
    }
  }
}
