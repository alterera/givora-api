import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import type { Request } from 'express';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { IS_PUBLIC, ROLES_KEY, SKIP_CSRF, type AuthUser } from './decorators.js';
import { forbidden, unauthorized } from './http.js';

const ACCESS_COOKIE = 'givora_access';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = readAccessToken(request);
    if (!token) {
      if (isPublic) return true;
      throw unauthorized();
    }
    try {
      const secret = new TextEncoder().encode(this.config.get('JWT_ACCESS_SECRET', { infer: true }));
      const { payload } = await jwtVerify(token, secret);
      const sessionId = typeof payload.sid === 'string' ? payload.sid : '';
      const userId = typeof payload.sub === 'string' ? payload.sub : '';
      const session = await this.prisma.session.findFirst({
        where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { user: true },
      });
      if (!session) throw unauthorized();
      request.user = {
        id: session.user.id,
        role: session.user.role,
        sessionId: session.id,
      };
      return true;
    } catch {
      if (isPublic) return true;
      throw unauthorized('Your session expired. Sign in again.');
    }
  }
}

function readAccessToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[ACCESS_COOKIE];
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Array<'CUSTOMER' | 'ADMIN'>>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!request.user || !roles.includes(request.user.role)) throw forbidden();
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const requestedWith = request.header('x-requested-with');
    if (requestedWith !== 'givora') {
      throw forbidden('Missing client header.');
    }
    const allowed = this.config.get('WEB_ORIGIN', { infer: true });
    const origin = request.header('origin');
    if (origin && origin !== allowed) throw forbidden('Untrusted origin.');
    const referer = request.header('referer');
    if (referer) {
      try {
        if (new URL(referer).origin !== allowed) throw forbidden('Untrusted referrer.');
      } catch (error) {
        if (error instanceof Error && error.message.includes('FORBIDDEN')) throw error;
        throw forbidden('Untrusted referrer.');
      }
    }
    return true;
  }
}

export { ACCESS_COOKIE };
