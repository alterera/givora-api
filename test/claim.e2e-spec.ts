import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';

const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)('stock reservation concurrency', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let variantId = '';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET ??= 'ci-secret-must-be-at-least-32-characters';
    process.env.OTP_PEPPER ??= 'ci-otp-pepper-value';
    process.env.WEB_ORIGIN ??= 'http://localhost:3000';
    process.env.PUBLIC_WEB_URL ??= 'http://localhost:3000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const product = await prisma.product.upsert({
      where: { slug: 'e2e-gift' },
      update: { status: 'ACTIVE' },
      create: { name: 'E2E Gift', slug: 'e2e-gift', description: 'Concurrency fixture', status: 'ACTIVE' },
    });
    const variant = await prisma.productVariant.upsert({
      where: { sku: 'E2E-SKU' },
      update: { onHand: 1, reserved: 0, isActive: true },
      create: { productId: product.id, sku: 'E2E-SKU', name: 'Only one', pricePaise: 10000, onHand: 1 },
    });
    variantId = variant.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets only one reservation succeed when one unit remains', async () => {
    const inventory = app.get(InventoryService);
    await prisma.productVariant.update({ where: { id: variantId }, data: { onHand: 1, reserved: 0 } });
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => inventory.reserve(tx, variantId, 1)),
      prisma.$transaction((tx) => inventory.reserve(tx, variantId, 1)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.reserved).toBe(1);
    await inventory.release(prisma, variantId, 1);
  });
});
