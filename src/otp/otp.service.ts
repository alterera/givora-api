import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { badRequest } from '../common/http.js';
import { otpCode, sha256 } from '../domain/tokens.js';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async issue(phone: string, purpose: string, contextKey?: string) {
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const recent = await this.prisma.otpChallenge.count({
      where: { phone, purpose, createdAt: { gt: since } },
    });
    if (recent >= 5) {
      throw badRequest('OTP_RATE_LIMIT', 'Too many codes. Wait a few minutes and try again.');
    }
    const code = otpCode();
    const pepper = this.config.get('OTP_PEPPER', { infer: true });
    await this.prisma.otpChallenge.create({
      data: {
        phone,
        purpose,
        contextKey,
        codeHash: sha256(`${pepper}:${purpose}:${phone}:${code}`),
        expiresAt: new Date(Date.now() + this.config.get('OTP_TTL_SECONDS', { infer: true }) * 1000),
      },
    });
    return code;
  }

  async consume(phone: string, purpose: string, code: string, contextKey?: string) {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        phone,
        purpose,
        contextKey: contextKey ?? null,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw badRequest('OTP_INVALID', 'That code is invalid or expired.');
    if (challenge.attempts >= challenge.maxAttempts) {
      throw badRequest('OTP_LOCKED', 'Too many attempts. Request a new code.');
    }
    const pepper = this.config.get('OTP_PEPPER', { infer: true });
    const expected = sha256(`${pepper}:${purpose}:${phone}:${code}`);
    if (expected !== challenge.codeHash) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw badRequest('OTP_INVALID', 'That code is invalid or expired.');
    }
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
  }
}
