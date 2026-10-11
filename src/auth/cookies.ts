import type { CookieOptions, Response } from 'express';
import type { AppEnv } from '../config/env.js';

export const ACCESS_COOKIE = 'givora_access';
export const REFRESH_COOKIE = 'givora_refresh';

export function cookieBase(env: AppEnv): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
  };
}

export function setAuthCookies(
  res: Response,
  env: AppEnv,
  access: string,
  refresh: string,
) {
  const base = cookieBase(env);
  res.cookie(ACCESS_COOKIE, access, {
    ...base,
    maxAge: env.ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, refresh, {
    ...base,
    maxAge: env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response, env: AppEnv) {
  const base = cookieBase(env);
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}
