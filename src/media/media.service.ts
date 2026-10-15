import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomToken } from '../domain/tokens.js';
import { badRequest } from '../common/http.js';
import type { AppEnv } from '../config/env.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DIGITAL = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/zip']);

@Injectable()
export class MediaService {
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async uploadProductImage(buffer: Buffer, contentType: string) {
    if (!ALLOWED.has(contentType)) throw badRequest('FILE_TYPE', 'Upload a JPEG, PNG, or WebP image.');
    const webp = await sharp(buffer)
      .rotate()
      .resize({ width: 1080, height: 1350, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const key = `products/${randomToken(12)}.webp`;
    const bucket = this.config.get('S3_BUCKET', { infer: true });
    await this.s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: webp,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    const publicUrl = `${this.config.get('S3_PUBLIC_BASE_URL', { infer: true }).replace(/\/$/, '')}/${key}`;
    return { publicUrl, key };
  }

  async presign(fileName: string, contentType: string) {
    if (!ALLOWED.has(contentType)) throw badRequest('FILE_TYPE', 'Upload a JPEG, PNG, or WebP image.');
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const key = `products/${randomToken(12)}.${ext}`;
    const bucket = this.config.get('S3_BUCKET', { infer: true });
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(this.s3(), command, { expiresIn: 300 });
    const publicUrl = `${this.config.get('S3_PUBLIC_BASE_URL', { infer: true }).replace(/\/$/, '')}/${key}`;
    return { uploadUrl, publicUrl, key, fileName };
  }

  async presignPrivate(fileName: string, contentType: string) {
    if (!DIGITAL.has(contentType)) throw badRequest('FILE_TYPE', 'Upload a PDF, image, or ZIP.');
    const key = `gifts/${randomToken(16)}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const bucket = this.config.get('S3_PRIVATE_BUCKET', { infer: true });
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(this.s3(), command, { expiresIn: 300 });
    return { uploadUrl, key, fileName, contentType };
  }

  async presignDownload(key: string, fileName: string) {
    const command = new GetObjectCommand({
      Bucket: this.config.get('S3_PRIVATE_BUCKET', { infer: true }),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
    });
    return getSignedUrl(this.s3(), command, { expiresIn: 300 });
  }

  private s3() {
    if (!this.client) {
      this.client = new S3Client({
        region: this.config.get('S3_REGION', { infer: true }),
        endpoint: this.config.get('S3_ENDPOINT', { infer: true }),
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.config.get('S3_ACCESS_KEY', { infer: true }),
          secretAccessKey: this.config.get('S3_SECRET_KEY', { infer: true }),
        },
      });
    }
    return this.client;
  }
}
