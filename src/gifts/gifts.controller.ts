import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, type AuthUser } from '../common/decorators.js';
import { GiftsService } from './gifts.service.js';
import { CheckoutDto, CreateGiftDto, PatchGiftDto } from './gifts.dto.js';
import { PaymentsService } from '../payments/payments.service.js';
import { OrdersService } from '../orders/orders.service.js';

@ApiTags('gifts')
@Controller('gifts')
export class GiftsController {
  constructor(
    private readonly gifts: GiftsService,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
  ) {}

  @Idempotent()
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGiftDto) {
    return this.gifts.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.gifts.listOwned(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gifts.getOwned(user.id, id);
  }

  @Patch(':id')
  patch(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PatchGiftDto) {
    return this.gifts.patch(user.id, id, dto);
  }

  @Idempotent()
  @Post(':id/checkout')
  checkout(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CheckoutDto) {
    return this.payments.checkout(user.id, id, dto);
  }

  @Get(':id/share')
  share(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gifts.share(user.id, id);
  }

  @Get(':id/status')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gifts.status(user.id, id);
  }

  @Post(':id/extend')
  extend(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gifts.extend(user.id, id);
  }

  @Post(':id/revoke')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.revokeGift(id, user.id, true);
  }
}
