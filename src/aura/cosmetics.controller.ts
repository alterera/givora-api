import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { CosmeticsService } from './cosmetics.service.js';
import { CosmeticCheckoutDto, CosmeticUnequipDto } from './cosmetics.dto.js';

@ApiTags('cosmetics')
@Controller()
export class CosmeticsController {
  constructor(private readonly cosmetics: CosmeticsService) {}

  @Get('aura/cosmetics')
  catalogue(@CurrentUser() user: AuthUser) {
    return this.cosmetics.catalogue(user.id);
  }

  @Post('aura/cosmetics/:slug/checkout')
  checkout(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() dto: CosmeticCheckoutDto) {
    return this.cosmetics.checkout(user.id, slug, dto.channel, dto.phone);
  }

  @Get('aura/cosmetics/purchases/:purchaseId/status')
  status(@CurrentUser() user: AuthUser, @Param('purchaseId') purchaseId: string) {
    return this.cosmetics.purchaseStatus(user.id, purchaseId);
  }

  @Post('aura/cosmetics/:slug/equip')
  equip(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.cosmetics.equip(user.id, slug);
  }

  @Post('aura/cosmetics/unequip')
  unequip(@CurrentUser() user: AuthUser, @Body() dto: CosmeticUnequipDto) {
    return this.cosmetics.unequip(user.id, dto.kind);
  }

  @Roles('ADMIN')
  @Get('admin/cosmetics')
  adminItems() {
    return this.cosmetics.adminListItems();
  }

  @Roles('ADMIN')
  @Get('admin/cosmetics/purchases')
  adminPurchases() {
    return this.cosmetics.adminListPurchases();
  }

  @Roles('ADMIN')
  @Post('admin/cosmetics/purchases/:purchaseId/revoke')
  revoke(@Param('purchaseId') purchaseId: string) {
    return this.cosmetics.revokePurchase(purchaseId);
  }
}
