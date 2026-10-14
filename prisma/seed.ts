import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'argon2';
import { loadEnvFiles } from '../src/config/load-env-file.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadEnvFiles();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const products = [
  {
    name: 'Classic Creator Postcard',
    slug: 'classic-creator-postcard',
    description: 'A signature ₹1 Givora thank-you token to test instant creator gifting.',
    story: 'A small gesture to brighten a creator’s day.',
    occasion: 'thank-you',
    category: 'home',
    pricePaise: 100,
    sku: 'GIFT-1RS',
  },
  {
    name: 'Brass Diya Set',
    slug: 'brass-diya-set',
    description: 'A pair of hand-finished brass diyas, packed ready to light.',
    story: 'For the person who makes ordinary evenings feel like a festival.',
    occasion: 'festivals',
    category: 'home',
    pricePaise: 149900,
    sku: 'DIYA-BRASS',
  },
  {
    name: 'Assam Tea Hamper',
    slug: 'assam-tea-hamper',
    description: 'Second-flush orthodox tea, honey, and a ceramic cup.',
    story: 'A quiet gift for someone who always remembers how you take your tea.',
    occasion: 'thank-you',
    category: 'hampers',
    pricePaise: 189900,
    sku: 'TEA-ASSAM',
  },
  {
    name: 'Silk Pocket Square',
    slug: 'silk-pocket-square',
    description: 'Handwoven silk in a deep indigo, boxed with a note card.',
    story: 'Small enough to surprise, considered enough to keep.',
    occasion: 'just-because',
    category: 'wear',
    pricePaise: 129900,
    sku: 'SILK-SQ',
  },
];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@givora.in';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeNow!2026';
  const passwordHash = await hash(password, { type: 2 });
  await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', passwordHash, emailVerifiedAt: new Date() },
    create: {
      email,
      passwordHash,
      role: 'ADMIN',
      displayName: 'Givora Admin',
      emailVerifiedAt: new Date(),
    },
  });

  const categoryRecords = [
    { slug: 'home', name: 'Home', description: 'Objects for the rooms they love' },
    { slug: 'hampers', name: 'Hampers', description: 'A few good things, together' },
    { slug: 'wear', name: 'To wear', description: 'Pieces they can carry with them' },
  ];
  for (const [index, category] of categoryRecords.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: category,
      create: { ...category, sortOrder: index },
    });
  }
  const occasions = [
    { slug: 'festivals', name: 'Festivals' },
    { slug: 'thank-you', name: 'Thank you' },
    { slug: 'just-because', name: 'Just because' },
  ];
  for (const occasion of occasions) {
    await prisma.occasion.upsert({ where: { slug: occasion.slug }, update: occasion, create: occasion });
  }

  for (const product of products) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: product.category } });
    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { slug: product.occasion } });
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: { status: 'ACTIVE' },
      create: {
        name: product.name,
        slug: product.slug,
        description: product.description,
        story: product.story,
        status: 'ACTIVE',
        categoryId: category.id,
        occasionId: occasion.id,
        variants: {
          create: {
            sku: product.sku,
            name: 'Standard',
            pricePaise: product.pricePaise,
            onHand: 25,
          },
        },
      },
    });
  }

  const creatorUser = await prisma.user.upsert({
    where: { email: 'sophia@givora.test' },
    update: {},
    create: { email: 'sophia@givora.test', displayName: 'Sophia', telegramId: '10001' },
  });
  const creator = await prisma.creatorProfile.upsert({
    where: { userId: creatorUser.id },
    update: { status: 'APPROVED', approvedAt: new Date() },
    create: {
      userId: creatorUser.id,
      slug: 'sophia',
      shortCode: 'c_sophia1',
      displayName: 'Sophia',
      bio: 'A wishlist of things I would love to receive.',
      giftNote: 'Send a gift. Make someone\'s day.',
      status: 'APPROVED',
      approvedAt: new Date(),
    },
  });
  const variants = await prisma.productVariant.findMany({ orderBy: { pricePaise: 'asc' }, take: 4 });
  for (const [index, variant] of variants.entries()) {
    await prisma.wishlistItem.upsert({
      where: { creatorId_variantId: { creatorId: creator.id, variantId: variant.id } },
      update: { sortOrder: index },
      create: { creatorId: creator.id, variantId: variant.id, sortOrder: index },
    });
  }

  const cosmetics = [
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
      description: 'Premium profile frame. Cosmetic only — does not change earned Aura rank.',
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
  for (const item of cosmetics) {
    await prisma.cosmeticItem.upsert({
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

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
