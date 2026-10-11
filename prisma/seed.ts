import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required to seed');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const products = [
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
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
