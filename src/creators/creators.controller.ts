import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators.js';
import { CreatorsService } from './creators.service.js';
import { ApplyCreatorDto, CreatorStatusDto, PatchCreatorDto, WishlistAddDto, WishlistPatchDto } from './creators.dto.js';

@ApiTags('creators')
@Controller()
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Post('creators/me')
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplyCreatorDto) {
    return this.creators.apply(user.id, dto);
  }

  @Get('creators/me')
  mine(@CurrentUser() user: AuthUser) {
    return this.creators.mine(user.id);
  }

  @Patch('creators/me')
  patch(@CurrentUser() user: AuthUser, @Body() dto: PatchCreatorDto) {
    return this.creators.patch(user.id, dto);
  }

  @Post('creators/me/wishlist')
  add(@CurrentUser() user: AuthUser, @Body() dto: WishlistAddDto) {
    return this.creators.addWishlist(user.id, dto.variantId);
  }

  @Patch('creators/me/wishlist/:id')
  patchItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WishlistPatchDto) {
    return this.creators.patchWishlist(user.id, id, dto);
  }

  @Delete('creators/me/wishlist/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.creators.removeWishlist(user.id, id);
  }

  @Public()
  @Get('creators/by-code/:code')
  byCode(@Param('code') code: string) {
    return this.creators.publicByCode(code);
  }

  @Public()
  @Get('creators/:slug')
  bySlug(@Param('slug') slug: string) {
    return this.creators.publicBySlug(slug);
  }

  @Roles('ADMIN')
  @Get('admin/creators')
  adminList() {
    return this.creators.adminList();
  }

  @Roles('ADMIN')
  @Patch('admin/creators/:id/status')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreatorStatusDto) {
    return this.creators.setStatus(id, dto.status, user.id);
  }
}
