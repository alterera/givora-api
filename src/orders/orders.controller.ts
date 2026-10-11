import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { OrdersService } from './orders.service.js';

class StatusDto {
  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class ShippingDto {
  @IsString()
  carrier!: string;

  @IsString()
  trackingRef!: string;
}

@ApiTags('orders')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  list(@CurrentUser() user: AuthUser) {
    return this.orders.listForSender(user.id);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.getForSender(user.id, id);
  }

  @Roles('ADMIN')
  @Get('admin/orders')
  adminList() {
    return this.orders.adminList();
  }

  @Roles('ADMIN')
  @Get('admin/gifts')
  adminGifts() {
    return this.orders.adminList();
  }

  @Roles('ADMIN')
  @Patch('admin/orders/:id/status')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.orders.transition(id, dto.status, user.id, dto.note);
  }

  @Roles('ADMIN')
  @Post('admin/orders/:id/shipping')
  shipping(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ShippingDto) {
    return this.orders.addShipping(id, dto.carrier, dto.trackingRef, user.id);
  }
}
