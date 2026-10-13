import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { CurrentUser, Public, SkipCsrf, type AuthUser } from '../common/decorators.js';
import { badRequest, forbidden } from '../common/http.js';
import type { AppEnv } from '../config/env.js';
import { AuthService } from '../auth/auth.service.js';
import { verifyTelegramInitData } from './init-data.js';
import { TelegramSender } from './telegram.sender.js';

class InitDataDto {
  @IsString()
  initData!: string;
}

@ApiTags('telegram')
@Controller()
export class TelegramController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly sender: TelegramSender,
  ) {}

  @Public()
  @Post('auth/telegram')
  login(@Body() dto: InitDataDto, @Req() req: Request) {
    const parsed = verifyTelegramInitData(dto.initData, this.config.get('TELEGRAM_BOT_TOKEN', { infer: true }));
    if (!parsed) throw badRequest('TELEGRAM_AUTH', 'Telegram could not verify this session. Reopen the app.');
    return this.auth.loginWithTelegram(parsed.user, { ip: req.ip, userAgent: req.header('user-agent') });
  }

  @Post('me/telegram/write-access')
  writeAccess(@CurrentUser() user: AuthUser) {
    return this.auth.markBotCanMessage(user.id);
  }

  @Public()
  @SkipCsrf()
  @Post('telegram/webhook')
  async webhook(
    @Body() update: {
      message?: { text?: string; from?: { id: number; username?: string; first_name?: string }; chat?: { id: number } };
    },
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    const expected = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true });
    if (!expected || secret !== expected) throw forbidden('Untrusted Telegram webhook.');
    const message = update.message;
    const text = message?.text ?? '';
    const chatId = message?.chat?.id;
    if (!chatId || !message?.from) return { ok: true };
    if (text.startsWith('/start')) {
      const session = await this.auth.loginWithTelegram(message.from, {});
      await this.auth.markBotCanMessage(session.user.id);
      const payload = text.split(/\s+/)[1]?.trim();
      const startParam = payload ? (payload.startsWith('c_') ? payload : `c_${payload}`) : undefined;
      const name = message.from.first_name?.trim() || 'there';
      const welcome = [
        `Hi ${name}!`,
        '',
        'GivoraWorld is private gifting for creators.',
        '• Fans send a gift from a creator’s wishlist link',
        '• Creators redeem gifts and keep their address private',
        '',
        'Tap below to open the app.',
      ].join('\n');
      await this.sender.sendMessage(chatId, welcome, startParam);
    }
    return { ok: true };
  }
}
