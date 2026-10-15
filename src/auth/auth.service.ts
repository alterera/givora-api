import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from 'argon2';
import type { Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { badRequest, unauthorized } from '../common/http.js';
import { normalizePhone } from '../domain/phone.js';
import { randomToken, sha256 } from '../domain/tokens.js';
import { OtpService } from '../otp/otp.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { clearAuthCookies, setAuthCookies } from './cookies.js';
import type { RegisterDto } from './auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly otp: OtpService,
    private readonly notifications: NotificationsService,
  ) {}

  private settings(): AppEnv {
    return {
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
      PORT: this.config.get('PORT', { infer: true }),
      DATABASE_URL: this.config.get('DATABASE_URL', { infer: true }),
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      PUBLIC_WEB_URL: this.config.get('PUBLIC_WEB_URL', { infer: true }),
      COOKIE_DOMAIN: this.config.get('COOKIE_DOMAIN', { infer: true }),
      JWT_ACCESS_SECRET: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      ACCESS_TTL_SECONDS: this.config.get('ACCESS_TTL_SECONDS', { infer: true }),
      REFRESH_TTL_DAYS: this.config.get('REFRESH_TTL_DAYS', { infer: true }),
      OTP_PEPPER: this.config.get('OTP_PEPPER', { infer: true }),
      OTP_TTL_SECONDS: this.config.get('OTP_TTL_SECONDS', { infer: true }),
      PAYMENT_WINDOW_MINUTES: this.config.get('PAYMENT_WINDOW_MINUTES', { infer: true }),
      GIFT_REDEEM_DAYS: this.config.get('GIFT_REDEEM_DAYS', { infer: true }),
      GIFT_REMINDER_DAYS: this.config.get('GIFT_REMINDER_DAYS', { infer: true }),
      AURA_INVITE_POINTS: this.config.get('AURA_INVITE_POINTS', { infer: true }),
      AURA_PAISE_PER_POINT: this.config.get('AURA_PAISE_PER_POINT', { infer: true }),
      STREAK_DAY_PRICE_PAISE: this.config.get('STREAK_DAY_PRICE_PAISE', { infer: true }),
      CASHFREE_ENV: this.config.get('CASHFREE_ENV', { infer: true }),
      CASHFREE_APP_ID: this.config.get('CASHFREE_APP_ID', { infer: true }),
      CASHFREE_SECRET_KEY: this.config.get('CASHFREE_SECRET_KEY', { infer: true }),
      CASHFREE_API_VERSION: this.config.get('CASHFREE_API_VERSION', { infer: true }),
      CASHFREE_WEBHOOK_SECRET: this.config.get('CASHFREE_WEBHOOK_SECRET', { infer: true }),
      WHATSAPP_TOKEN: this.config.get('WHATSAPP_TOKEN', { infer: true }),
      WHATSAPP_PHONE_NUMBER_ID: this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true }),
      WHATSAPP_OTP_TEMPLATE: this.config.get('WHATSAPP_OTP_TEMPLATE', { infer: true }),
      WHATSAPP_API_VERSION: this.config.get('WHATSAPP_API_VERSION', { infer: true }),
      WHATSAPP_API_BASE_URL: this.config.get('WHATSAPP_API_BASE_URL', { infer: true }),
      WHATSAPP_API_KEY: this.config.get('WHATSAPP_API_KEY', { infer: true }),
      WHATSAPP_OTP_TEMPLATE_NAME: this.config.get('WHATSAPP_OTP_TEMPLATE_NAME', { infer: true }),
      WHATSAPP_OTP_TEMPLATE_LANGUAGE: this.config.get('WHATSAPP_OTP_TEMPLATE_LANGUAGE', { infer: true }),
      SMTP_HOST: this.config.get('SMTP_HOST', { infer: true }),
      SMTP_PORT: this.config.get('SMTP_PORT', { infer: true }),
      SMTP_USER: this.config.get('SMTP_USER', { infer: true }),
      SMTP_PASS: this.config.get('SMTP_PASS', { infer: true }),
      SMTP_FROM: this.config.get('SMTP_FROM', { infer: true }),
      S3_ENDPOINT: this.config.get('S3_ENDPOINT', { infer: true }),
      S3_REGION: this.config.get('S3_REGION', { infer: true }),
      S3_BUCKET: this.config.get('S3_BUCKET', { infer: true }),
      S3_ACCESS_KEY: this.config.get('S3_ACCESS_KEY', { infer: true }),
      S3_SECRET_KEY: this.config.get('S3_SECRET_KEY', { infer: true }),
      S3_PUBLIC_BASE_URL: this.config.get('S3_PUBLIC_BASE_URL', { infer: true }),
      S3_PRIVATE_BUCKET: this.config.get('S3_PRIVATE_BUCKET', { infer: true }),
      TELEGRAM_BOT_TOKEN: this.config.get('TELEGRAM_BOT_TOKEN', { infer: true }),
      TELEGRAM_BOT_USERNAME: this.config.get('TELEGRAM_BOT_USERNAME', { infer: true }),
      TELEGRAM_WEBHOOK_SECRET: this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true }),
      MINIAPP_URL: this.config.get('MINIAPP_URL', { infer: true }),
      SWAGGER_USER: this.config.get('SWAGGER_USER', { infer: true }),
      SWAGGER_PASSWORD: this.config.get('SWAGGER_PASSWORD', { infer: true }),
      SEED_ADMIN_EMAIL: this.config.get('SEED_ADMIN_EMAIL', { infer: true }),
      SEED_ADMIN_PASSWORD: this.config.get('SEED_ADMIN_PASSWORD', { infer: true }),
    };
  }

  async register(dto: RegisterDto, res: Response, meta: { ip?: string; userAgent?: string }) {
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone ? this.parsePhone(dto.phone) : undefined;
    if (!email && !phone) throw badRequest('IDENTITY_REQUIRED', 'Add an email or a mobile number.');
    const passwordHash = await hash(dto.password, { type: 2 });
    const user = await this.prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        displayName: dto.displayName?.trim(),
        phoneVerifiedAt: phone ? null : undefined,
      },
    }).catch(() => {
      throw badRequest('ACCOUNT_EXISTS', 'An account with those details already exists.');
    });
    if (email) await this.sendEmailVerification(user.id, email);
    return this.issueSession(user.id, user.role, res, meta);
  }

  async login(identifier: string, password: string, res: Response, meta: { ip?: string; userAgent?: string }) {
    const email = identifier.includes('@') ? identifier.trim().toLowerCase() : undefined;
    const phone = email ? undefined : this.safePhone(identifier);
    const user = await this.prisma.user.findFirst({
      where: email ? { email } : { phone: phone ?? '__none__' },
    });
    if (!user?.passwordHash) throw unauthorized('Those details do not match.');
    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw unauthorized('Those details do not match.');
    return this.issueSession(user.id, user.role, res, meta);
  }

  async requestOtp(phoneRaw: string) {
    const phone = this.parsePhone(phoneRaw);
    const code = await this.otp.issue(phone, 'login');
    await this.notifications.sendOtp(phone, code);
    return { sent: true };
  }

  async verifyOtp(phoneRaw: string, code: string, res: Response, meta: { ip?: string; userAgent?: string }) {
    const phone = this.parsePhone(phoneRaw);
    await this.otp.consume(phone, 'login', code);
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: { phoneVerifiedAt: new Date() },
      create: { phone, phoneVerifiedAt: new Date(), displayName: 'Guest' },
    });
    return this.issueSession(user.id, user.role, res, meta);
  }

  async refresh(refreshToken: string | undefined, res: Response, meta: { ip?: string; userAgent?: string }) {
    if (!refreshToken) throw unauthorized();
    const refreshHash = sha256(refreshToken);
    const current = await this.prisma.session.findUnique({ where: { refreshHash }, include: { user: true } });
    if (!current) throw unauthorized();
    if (current.revokedAt || current.replacedById) {
      await this.prisma.session.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized('This session was reused and has been revoked. Sign in again.');
    }
    if (current.expiresAt.getTime() < Date.now()) throw unauthorized();
    const next = await this.createSession(current.userId, current.familyId, meta);
    await this.prisma.session.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), replacedById: next.id },
    });
    const access = await this.signAccess(current.userId, current.user.role, next.id);
    setAuthCookies(res, this.settings(), access, next.raw);
    return this.publicUser(current.userId);
  }

  async logout(sessionId: string | undefined, res: Response) {
    if (sessionId) {
      await this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearAuthCookies(res, this.settings());
    return { ok: true };
  }

  async me(userId: string) {
    return this.publicUser(userId);
  }

  async sendEmailVerification(userId: string, email: string) {
    const token = randomToken(24);
    await this.prisma.actionToken.create({
      data: {
        userId,
        purpose: 'verify-email',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });
    const url = `${this.settings().PUBLIC_WEB_URL}/login?verify=${token}`;
    await this.notifications.sendEmail(email, 'Verify your Givora email', `Confirm your email: ${url}`);
    return { sent: true };
  }

  async verifyEmail(token: string) {
    const row = await this.consumeActionToken(token, 'verify-email');
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user?.email) throw badRequest('NO_EMAIL', 'This account has no email.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    return { verified: true };
  }

  async forgotPassword(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomToken(24);
      await this.prisma.actionToken.create({
        data: {
          userId: user.id,
          purpose: 'reset-password',
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 1000 * 60 * 30),
        },
      });
      const url = `${this.settings().PUBLIC_WEB_URL}/forgot-password?token=${token}`;
      await this.notifications.sendEmail(email, 'Reset your Givora password', `Reset your password: ${url}`);
    }
    return { sent: true };
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeActionToken(token, 'reset-password');
    const passwordHash = await hash(password, { type: 2 });
    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await this.prisma.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { reset: true };
  }

  async setPassword(userId: string, password: string) {
    const passwordHash = await hash(password, { type: 2 });
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { updated: true };
  }

  async loginWithTelegram(
    profile: { id: number | string; username?: string; first_name?: string; last_name?: string },
    meta: { ip?: string; userAgent?: string },
  ) {
    const telegramId = String(profile.id);
    const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Telegram user';
    const user = await this.prisma.user.upsert({
      where: { telegramId },
      update: {
        telegramUsername: profile.username,
        displayName,
      },
      create: {
        telegramId,
        telegramUsername: profile.username,
        displayName,
      },
    });
    const session = await this.createSession(user.id, randomToken(16), meta);
    const accessToken = await this.signAccess(user.id, user.role, session.id);
    return { accessToken, user: await this.publicUser(user.id) };
  }

  async markBotCanMessage(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { botCanMessage: true } });
    return { ok: true };
  }

  async signClaimTicket(giftId: string, phone: string) {
    const secret = new TextEncoder().encode(this.settings().JWT_ACCESS_SECRET);
    return new SignJWT({ purpose: 'claim', giftId, phone })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .setIssuedAt()
      .sign(secret);
  }

  async readClaimTicket(token: string, giftId: string) {
    const secret = new TextEncoder().encode(this.settings().JWT_ACCESS_SECRET);
    try {
      const { payload } = await jwtVerify(token, secret);
      if (payload.purpose !== 'claim' || payload.giftId !== giftId || typeof payload.phone !== 'string') {
        throw unauthorized('Verify your mobile number again.');
      }
      return payload.phone;
    } catch {
      throw unauthorized('Verify your mobile number again.');
    }
  }

  private async consumeActionToken(token: string, purpose: string) {
    const row = await this.prisma.actionToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
      throw badRequest('TOKEN_INVALID', 'This link is invalid or has expired.');
    }
    await this.prisma.actionToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return row;
  }

  private async issueSession(
    userId: string,
    role: 'CUSTOMER' | 'ADMIN',
    res: Response,
    meta: { ip?: string; userAgent?: string },
  ) {
    const session = await this.createSession(userId, randomToken(16), meta);
    const access = await this.signAccess(userId, role, session.id);
    setAuthCookies(res, this.settings(), access, session.raw);
    return this.publicUser(userId);
  }

  private async createSession(userId: string, familyId: string, meta: { ip?: string; userAgent?: string }) {
    const raw = randomToken(32);
    const days = this.settings().REFRESH_TTL_DAYS;
    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        refreshHash: sha256(raw),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    return { id: session.id, raw };
  }

  private async signAccess(userId: string, role: string, sessionId: string) {
    const env = this.settings();
    const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    return new SignJWT({ role, sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${env.ACCESS_TTL_SECONDS}s`)
      .sign(secret);
  }

  private async publicUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      telegramUsername: user.telegramUsername,
      createdAt: user.createdAt.toISOString(),
      role: user.role,
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      hasPassword: Boolean(user.passwordHash),
    };
  }

  private parsePhone(input: string) {
    try {
      return normalizePhone(input);
    } catch {
      throw badRequest('INVALID_PHONE', 'Enter a valid mobile number.');
    }
  }

  private safePhone(input: string) {
    try {
      return normalizePhone(input);
    } catch {
      return undefined;
    }
  }
}
