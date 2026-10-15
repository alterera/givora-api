import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { loadEnv } from '../src/config/env.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

const bucket = env.S3_BUCKET;
const publicBase = env.S3_PUBLIC_BASE_URL.replace(/\/$/, '');

async function fetchObject(url: string) {
  const key = url.replace(`${publicBase}/`, '');
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty object for ${key}`);
  return { key, buffer: Buffer.from(bytes) };
}

async function main() {
  const images = await prisma.productImage.findMany({ orderBy: { id: 'asc' } });
  for (const image of images) {
    if (image.url.endsWith('.webp')) {
      console.log(`skip ${image.id} (already webp)`);
      continue;
    }
    try {
      const { key, buffer } = await fetchObject(image.url);
      const webp = await sharp(buffer)
        .rotate()
        .resize({ width: 1080, height: 1350, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const nextKey = key.replace(/\.[^.]+$/, '.webp');
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: nextKey,
          Body: webp,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      const publicUrl = `${publicBase}/${nextKey}`;
      await prisma.productImage.update({ where: { id: image.id }, data: { url: publicUrl } });
      console.log(`optimized ${image.id} -> ${publicUrl}`);
    } catch (error) {
      console.error(`failed ${image.id}`, error);
    }
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
