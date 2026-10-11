import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Idempotent, Public } from '../common/decorators.js';
import { Throttle } from '@nestjs/throttler';
import { RedemptionsService } from './redemptions.service.js';
import { ClaimDto, ClaimOtpDto, ClaimOtpVerifyDto } from './redemptions.dto.js';

@ApiTags('redemption')
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('public/gifts')
export class RedemptionsController {
  constructor(private readonly redemptions: RedemptionsService) {}

  @Get(':token')
  reveal(@Param('token') token: string) {
    return this.redemptions.reveal(token);
  }

  @Post(':token/opened')
  opened(@Param('token') token: string) {
    return this.redemptions.markOpened(token);
  }

  @Post(':token/otp/request')
  requestOtp(@Param('token') token: string, @Body() dto: ClaimOtpDto) {
    return this.redemptions.requestClaimOtp(token, dto.phone);
  }

  @Post(':token/otp/verify')
  verifyOtp(@Param('token') token: string, @Body() dto: ClaimOtpVerifyDto) {
    return this.redemptions.verifyClaimOtp(token, dto.phone, dto.code);
  }

  @Idempotent()
  @Post(':token/claim')
  claim(@Param('token') token: string, @Body() dto: ClaimDto) {
    return this.redemptions.claim(token, dto);
  }

  @Get(':token/claim-status')
  status(@Param('token') token: string) {
    return this.redemptions.claimStatus(token);
  }
}
