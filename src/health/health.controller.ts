import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AppEnv } from '../config/env.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  @Public()
  @Get()
  async check() {
    let database: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    let media: 'ok' | 'skipped' | 'error' = 'skipped';
    const accessKey = this.config.get('S3_ACCESS_KEY', { infer: true });
    if (accessKey) {
      try {
        const client = new S3Client({
          region: this.config.get('S3_REGION', { infer: true }),
          endpoint: this.config.get('S3_ENDPOINT', { infer: true }),
          forcePathStyle: true,
          credentials: {
            accessKeyId: accessKey,
            secretAccessKey: this.config.get('S3_SECRET_KEY', { infer: true }),
          },
        });
        await client.send(new HeadBucketCommand({ Bucket: this.config.get('S3_BUCKET', { infer: true }) }));
        media = 'ok';
      } catch {
        media = 'error';
      }
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      media,
    };
  }
}
