import { Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public, Roles, SkipCsrf, type AuthUser } from '../common/decorators.js';
import { PaymentsService } from './payments.service.js';
import { badRequest } from '../common/http.js';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments/:id/status')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.statusForBuyer(user.id, id);
  }

  @Get('payments/provider-order/status')
  lookup(@CurrentUser() user: AuthUser, @Query('orderId') orderId: string) {
    if (!orderId) throw badRequest('ORDER_REQUIRED', 'Missing order id.');
    return this.payments.statusByProviderOrder(user.id, orderId);
  }

  @Get('payments/orders/:orderId/status')
  orderStatus(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.payments.statusForOrder(user.id, orderId);
  }

  @Public()
  @SkipCsrf()
  @Post('webhooks/cashfree')
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-timestamp') timestamp?: string,
    @Headers('x-webhook-signature') signature?: string,
  ) {
    return this.payments.handleWebhook(req.rawBody?.toString('utf8') ?? '', timestamp, signature);
  }

  @Roles('ADMIN')
  @Post('admin/payments/:id/refunds')
  refund(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.refundPayment(id, user.id, 'Admin refund');
  }
}
