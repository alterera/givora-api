import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { conflict } from '../common/http.js';

type Tx = Pick<PrismaService, '$executeRaw' | 'productVariant' | 'stockAdjustment'>;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(tx: Tx, variantId: string, quantity: number) {
    const updated = await tx.$executeRaw`
      UPDATE "product_variants"
      SET "reserved" = "reserved" + ${quantity}, "updated_at" = NOW()
      WHERE "id" = ${variantId}
        AND "on_hand" - "reserved" >= ${quantity}
    `;
    if (updated !== 1) throw conflict('OUT_OF_STOCK', 'That gift is no longer available.');
  }

  async release(tx: Tx, variantId: string, quantity: number) {
    const updated = await tx.$executeRaw`
      UPDATE "product_variants"
      SET "reserved" = "reserved" - ${quantity}, "updated_at" = NOW()
      WHERE "id" = ${variantId} AND "reserved" >= ${quantity}
    `;
    if (updated !== 1) throw conflict('STOCK_STATE', 'Stock reservation could not be released.');
  }

  async commit(tx: Tx, variantId: string, quantity: number) {
    const updated = await tx.$executeRaw`
      UPDATE "product_variants"
      SET "on_hand" = "on_hand" - ${quantity},
          "reserved" = "reserved" - ${quantity},
          "updated_at" = NOW()
      WHERE "id" = ${variantId}
        AND "reserved" >= ${quantity}
        AND "on_hand" >= ${quantity}
    `;
    if (updated !== 1) throw conflict('STOCK_STATE', 'Reserved stock could not be committed.');
  }

  async restoreCommitted(tx: Tx, variantId: string, quantity: number) {
    const updated = await tx.$executeRaw`
      UPDATE "product_variants"
      SET "on_hand" = "on_hand" + ${quantity}, "updated_at" = NOW()
      WHERE "id" = ${variantId}
    `;
    if (updated !== 1) throw conflict('STOCK_STATE', 'Stock could not be restored.');
  }

  async adjust(variantId: string, delta: number, reason: string, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "product_variants"
        SET "on_hand" = "on_hand" + ${delta}, "updated_at" = NOW()
        WHERE "id" = ${variantId}
          AND "on_hand" + ${delta} >= "reserved"
          AND "on_hand" + ${delta} >= 0
      `;
      if (updated !== 1) throw conflict('STOCK_STATE', 'That stock change would go below active holds.');
      const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      await tx.stockAdjustment.create({
        data: {
          variantId,
          delta,
          onHand: variant.onHand,
          reserved: variant.reserved,
          reason,
          actorId,
        },
      });
      return { onHand: variant.onHand, reserved: variant.reserved };
    });
  }
}
