import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) =>
        new PrismaService(config.get('DATABASE_URL', { infer: true })),
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
