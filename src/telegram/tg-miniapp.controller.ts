import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators.js';
import { TgMiniAppService } from './tg-miniapp.service.js';

@ApiTags('telegram-miniapp')
@Controller('tg')
export class TgMiniAppController {
  constructor(private readonly tg: TgMiniAppService) {}

  @Get('boot')
  boot(@CurrentUser() user: AuthUser) {
    return this.tg.boot(user.id);
  }

  @Get('wishlist/:slugOrCode')
  wishlist(@CurrentUser() user: AuthUser, @Param('slugOrCode') slugOrCode: string) {
    return this.tg.wishlistBundle(user.id, slugOrCode);
  }
}
