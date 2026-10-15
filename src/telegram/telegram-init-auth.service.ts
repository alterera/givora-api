import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import type { AuthUser } from '../common/decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { verifyTelegramInitData } from './init-data.js';

type CachedTelegramUser = {
  id: string;
  role: 'CUSTOMER' | 'ADMIN';
  isCreator: boolean;
  creatorSlug: string | null;
  expiresAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class TelegramInitAuthService {
  private readonly cache = new Map<string, CachedTelegramUser>();

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(initData: string): Promise<AuthUser | null> {
    const parsed = verifyTelegramInitData(initData, this.config.get('TELEGRAM_BOT_TOKEN', { infer: true }));
    if (!parsed) return null;

    const telegramId = String(parsed.user.id);
    const cached = this.cache.get(telegramId);
    if (cached && cached.expiresAt > Date.now()) {
      return { id: cached.id, role: cached.role, sessionId: '' };
    }

    const displayName = [parsed.user.first_name, parsed.user.last_name].filter(Boolean).join(' ') || 'Telegram user';
    const user = await this.prisma.user.upsert({
      where: { telegramId },
      update: {
        telegramUsername: parsed.user.username,
        displayName,
      },
      create: {
        telegramId,
        telegramUsername: parsed.user.username,
        displayName,
      },
      include: { creator: { select: { slug: true } } },
    });

    const entry: CachedTelegramUser = {
      id: user.id,
      role: user.role,
      isCreator: Boolean(user.creator),
      creatorSlug: user.creator?.slug ?? null,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    this.cache.set(telegramId, entry);

    return { id: user.id, role: user.role, sessionId: '' };
  }

  peek(telegramId: string): CachedTelegramUser | null {
    const cached = this.cache.get(telegramId);
    if (!cached || cached.expiresAt <= Date.now()) return null;
    return cached;
  }

  setCreatorFlag(telegramId: string, isCreator: boolean, creatorSlug: string | null) {
    const cached = this.cache.get(telegramId);
    if (!cached) return;
    this.cache.set(telegramId, { ...cached, isCreator, creatorSlug });
  }
}
