import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './config/env.js';
import { PrismaModule } from './database/prisma.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { CsrfGuard, JwtAuthGuard, RolesGuard } from './common/guards.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { OtpService } from './otp/otp.service.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { AuditService } from './audit/audit.service.js';
import { InventoryService } from './inventory/inventory.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { CatalogService } from './catalog/catalog.service.js';
import { MediaService } from './media/media.service.js';
import { GiftsController } from './gifts/gifts.controller.js';
import { GiftsService } from './gifts/gifts.service.js';
import { PaymentsController } from './payments/payments.controller.js';
import { PaymentsService } from './payments/payments.service.js';
import { CashfreeProvider } from './payments/cashfree/cashfree.provider.js';
import { RedemptionsController } from './redemptions/redemptions.controller.js';
import { RedemptionsService } from './redemptions/redemptions.service.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { HealthController } from './health/health.controller.js';
import { LookupController } from './lookup/lookup.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadEnv()] }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.code',
            'req.body.claimTicket',
            'req.body.token',
          ],
          censor: '[redacted]',
        },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    CatalogController,
    GiftsController,
    PaymentsController,
    RedemptionsController,
    OrdersController,
    LookupController,
  ],
  providers: [
    AuthService,
    OtpService,
    NotificationsService,
    AuditService,
    InventoryService,
    CatalogService,
    MediaService,
    GiftsService,
    PaymentsService,
    CashfreeProvider,
    RedemptionsService,
    OrdersService,
    MaintenanceService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
