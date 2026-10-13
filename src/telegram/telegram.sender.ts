import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class TelegramSender {
  private readonly logger = new Logger(TelegramSender.name);

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {}

  async sendMessage(chatId: string | number, text: string, startParam?: string) {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    const mini = this.config.get('MINIAPP_URL', { infer: true });
    if (!token) {
      await this.log(String(chatId), 'skipped', 'missing bot token');
      return;
    }
    const url = startParam ? `${mini}?start=${encodeURIComponent(startParam)}` : mini;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [[{ text: 'Open Givora', web_app: { url } }]],
        },
      }),
    });
    await this.log(String(chatId), response.ok ? 'sent' : 'failed', response.ok ? undefined : await response.text());
    if (!response.ok) this.logger.warn('Telegram message failed');
  }

  async notifyUser(user: { telegramId: string | null; botCanMessage: boolean } | null, text: string, startParam?: string) {
    if (!user?.telegramId || !user.botCanMessage) return;
    await this.sendMessage(user.telegramId, text, startParam);
  }

  private async log(to: string, status: string, error?: string) {
    await this.prisma.notificationLog.create({
      data: { channel: 'telegram', to: to.slice(0, 8), template: 'message', status, error: error?.slice(0, 300) },
    });
  }
}
