import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { AuraService } from './aura.service.js';
import { AuraAdminAdjustDto } from './aura.dto.js';

@ApiTags('aura')
@Controller()
export class AuraController {
  constructor(private readonly aura: AuraService) {}

  @Get('me/aura')
  mine(@CurrentUser() user: AuthUser) {
    return this.aura.profile(user.id);
  }

  @Get('me/aura/activity')
  activity(@CurrentUser() user: AuthUser, @Query('cursor') cursor?: string) {
    return this.aura.activity(user.id, cursor);
  }

  @Get('creators/:slug/invite')
  inviteStatus(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.aura.inviteStatus(user.id, slug);
  }

  @Post('creators/:slug/invite/accept')
  acceptInvite(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.aura.acceptInvite(user.id, slug);
  }

  @Roles('ADMIN')
  @Post('admin/aura/adjustments')
  adjust(@CurrentUser() user: AuthUser, @Body() dto: AuraAdminAdjustDto) {
    return this.aura.adminAdjust(user.id, dto.userId, dto.amount, dto.reason, dto.idempotencyKey);
  }
}
