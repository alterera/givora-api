import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, tap } from 'rxjs';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { sha256 } from '../domain/tokens.js';
import { IDEMPOTENT, type AuthUser } from './decorators.js';
import { badRequest, conflict } from './http.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const enabled = this.reflector.get<boolean>(IDEMPOTENT, context.getHandler());
    if (!enabled) return next.handle();
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const key = request.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 200) {
      throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header.');
    }
    const route = `${request.method} ${request.path}`;
    const scope = request.user?.id ?? request.ip ?? 'anon';
    const requestHash = sha256(JSON.stringify(request.body ?? {}));
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { key_scope_route: { key, scope, route } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw conflict('IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different request.');
      }
      return of(existing.responseBody);
    }
    return next.handle().pipe(
      tap((body) => {
        void this.prisma.idempotencyRecord
          .create({
            data: {
              key,
              scope,
              route,
              requestHash,
              statusCode: 200,
              responseBody: body as object,
            },
          })
          .catch(() => undefined);
      }),
    );
  }
}
