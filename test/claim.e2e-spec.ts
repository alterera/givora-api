import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { sha256 } from '../src/domain/tokens.js';

const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)('gift claim concurrency', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let variantId = '';
  let token = '';

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

    const category = await prisma.category.upsert({
      where: { slug: 'e2e' },
      update: {},
      create: { name: 'E2E', slug: 'e2e' },
    });
    const product = await prisma.product.upsert({
      where: { slug: 'e2e-gift' },
      update: { status: 'ACTIVE' },
      create: {
        name: 'E2E Gift',
        slug: 'e2e-gift',
        description: 'Concurrency fixture',
        status: 'ACTIVE',
        categoryId: category.id,
      },
    });
    const variant = await prisma.productVariant.upsert({
      where: { sku: 'E2E-SKU' },
      update: { onHand: 1, reserved: 0, pricePaise: 10000, isActive: true },
      create: {
        productId: product.id,
        sku: 'E2E-SKU',
        name: 'Only one',
        pricePaise: 10000,
        onHand: 1,
        reserved: 0,
      },
    });
    variantId = variant.id;

    const sender = await prisma.user.upsert({
      where: { email: 'e2e-sender@givora.test' },
      update: {},
      create: { email: 'e2e-sender@givora.test', displayName: 'Sender', phoneVerifiedAt: new Date(), phone: '+919000000001' },
    });
    token = 'e2e-token-value-not-a-secret-in-ci';
    const gift = await prisma.gift.create({
      data: {
        publicRef: `E2E${Date.now().toString(36).toUpperCase()}`,
        senderId: sender.id,
        status: 'READY_TO_SEND',
        message: 'For you',
        senderDisplayName: 'Sender',
        revealTheme: 'cinematic',
        subtotalPaise: 10000,
        shippingPaise: 0,
        totalPaise: 10000,
        paymentExpiresAt: new Date(Date.now() + 60_000),
        claimExpiresAt: new Date(Date.now() + 86_400_000),
        tokenHash: sha256(token),
        items: {
          create: {
            variantId: variant.id,
            productName: 'E2E Gift',
            variantName: 'Only one',
            quantity: 1,
            unitPricePaise: 10000,
            lineTotalPaise: 10000,
          },
        },
      },
    });
    void gift;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets only one of two concurrent claims succeed', async () => {
    const otp = await prisma.otpChallenge.create({
      data: {
        phone: '+919000000002',
        purpose: 'claim',
        codeHash: 'unused',
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
      },
    });
    void otp;
    const ticketResponse = await request(app.getHttpServer())
      .post(`/api/v1/public/gifts/${token}/otp/verify`)
      .set('x-requested-with', 'givora')
      .set('origin', 'http://localhost:3000')
      .send({ phone: '9000000002', code: '000000' });
    expect(ticketResponse.status).toBe(400);

    const { SignJWT } = await import('jose');
    const claimTicket = await new SignJWT({
      purpose: 'claim',
      giftId: (await prisma.gift.findFirstOrThrow({ where: { tokenHash: sha256(token) } })).id,
      phone: '+919000000002',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));

    const body = {
      recipientName: 'Alex',
      phone: '+919000000002',
      claimTicket,
      address: {
        line1: 'House 1',
        line2: '',
        city: 'Guwahati',
        state: 'Assam',
        postalCode: '781001',
        countryCode: 'IN',
      },
    };
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/public/gifts/${token}/claim`)
        .set('x-requested-with', 'givora')
        .set('origin', 'http://localhost:3000')
        .set('idempotency-key', `claim-a-${Date.now()}`)
        .send(body),
      request(app.getHttpServer())
        .post(`/api/v1/public/gifts/${token}/claim`)
        .set('x-requested-with', 'givora')
        .set('origin', 'http://localhost:3000')
        .set('idempotency-key', `claim-b-${Date.now()}`)
        .send(body),
    ]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
    const orders = await prisma.fulfilmentOrder.count({
      where: { gift: { tokenHash: sha256(token) } },
    });
    expect(orders).toBe(1);
    expect(variantId).toBeTruthy();
  });

  it('refuses a second reservation when stock is one', async () => {
    const { InventoryService } = await import('../src/inventory/inventory.service.js');
    const inventory = app.get(InventoryService);
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => inventory.reserve(tx, variantId, 1)),
      prisma.$transaction((tx) => inventory.reserve(tx, variantId, 1)),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.reserved).toBe(1);
    await inventory.release(prisma, variantId, 1);
  });
});
