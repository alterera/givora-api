import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_CSRF = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<'CUSTOMER' | 'ADMIN'>) => SetMetadata(ROLES_KEY, roles);

export const IDEMPOTENT = 'idempotent';
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

export interface AuthUser {
  id: string;
  role: 'CUSTOMER' | 'ADMIN';
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return request.user;
});
