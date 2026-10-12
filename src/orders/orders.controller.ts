import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, type AuthUser } from '../common/decorators.js';
import { OrdersService } from './orders.service.js';
import { CheckoutOrderDto, CreateOrderDto } from './orders.dto.js';
import { PaymentsService } from '../payments/payments.service.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  @Idempotent()
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.orders.listForBuyer(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.getForBuyer(user.id, id);
  }

  @Idempotent()
  @Post(':id/checkout')
  checkout(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CheckoutOrderDto) {
    return this.payments.checkout(user.id, id, dto);
  }
}
