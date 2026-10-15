import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators.js';
import { StreakCheckoutDto } from './streak.dto.js';
import { StreakService } from './streak.service.js';

@ApiTags('streaks')
@Controller()
export class StreakController {
  constructor(private readonly streaks: StreakService) {}

  @Get('creators/:slug/streak')
  status(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.streaks.status(user.id, slug);
  }

  @Post('creators/:slug/streak/checkout')
  checkout(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() dto: StreakCheckoutDto) {
    return this.streaks.checkout(user.id, slug, dto.channel, dto.phone);
  }

  @Get('streak/purchases/:purchaseId/status')
  purchaseStatus(@CurrentUser() user: AuthUser, @Param('purchaseId') purchaseId: string) {
    return this.streaks.purchaseStatus(user.id, purchaseId);
  }
}
