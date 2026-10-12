import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, Roles, type AuthUser } from '../common/decorators.js';
import { GiftsService } from './gifts.service.js';
import { AddressDto, RedeemDto, ShipmentStatusDto, TrackingDto } from './gifts.dto.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { CheckoutOrderDto, CreateOrderDto } from '../orders/orders.dto.js';

@ApiTags('gifts')
@Controller()
export class GiftsController {
  constructor(
    private readonly gifts: GiftsService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  @Idempotent()
  @Post('gifts')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Idempotent()
  @Post('gifts/:id/checkout')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CheckoutOrderDto) {
    return this.payments.checkout(user.id, id, dto);
  }

  @Get('gifts/received')
  received(@CurrentUser() user: AuthUser) {
    return this.gifts.received(user.id);
  }

  @Get('gifts/:id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gifts.getOne(user.id, id, user.role);
  }

  @Post('gifts/:id/opened')
  opened(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gifts.opened(user.id, id);
  }

  @Idempotent()
  @Post('gifts/:id/redeem')
  redeem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RedeemDto) {
    return this.gifts.redeem(user.id, id, dto);
  }

  @Get('gifts/:id/download')
  download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.gifts.download(user.id, id);
  }

  @Get('me/addresses')
  addresses(@CurrentUser() user: AuthUser) {
    return this.gifts.listAddresses(user.id);
  }

  @Post('me/addresses')
  addAddress(@CurrentUser() user: AuthUser, @Body() dto: AddressDto) {
    return this.gifts.addAddress(user.id, dto);
  }

  @Roles('ADMIN')
  @Get('admin/shipments')
  shipments() {
    return this.gifts.adminShipments();
  }

  @Roles('ADMIN')
  @Patch('admin/shipments/:id/status')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ShipmentStatusDto) {
    return this.gifts.transitionShipment(id, dto.status, user.id, dto.note);
  }

  @Roles('ADMIN')
  @Post('admin/shipments/:id/tracking')
  tracking(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TrackingDto) {
    return this.gifts.addTracking(id, dto.carrier, dto.trackingRef, user.id);
  }

  @Roles('ADMIN')
  @Get('admin/stats')
  stats() {
    return this.gifts.adminStats();
  }
}
