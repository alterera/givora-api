import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomToken } from '../domain/tokens.js';
import { badRequest } from '../common/http.js';
import type { AppEnv } from '../config/env.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class MediaService {
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

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
