import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../common/decorators.js';
import { AuthService } from './auth.service.js';
import {
  EmailTokenDto,
  ForgotPasswordDto,
  LoginDto,
  OtpRequestDto,
  OtpVerifyDto,
  RegisterDto,
  ResetPasswordDto,
  SetPasswordDto,
} from './auth.dto.js';
import { REFRESH_COOKIE } from './cookies.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(dto, res, { ip: req.ip, userAgent: req.header('user-agent') });
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto.identifier, dto.password, res, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
  }

  @Public()
  @Post('otp/request')
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.verifyOtp(dto.phone, dto.code, res, { ip: req.ip, userAgent: req.header('user-agent') });
  }

  @Public()
  @Post('refresh')
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    return this.auth.refresh(cookies?.[REFRESH_COOKIE], res, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(user?.sessionId, res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: EmailTokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('password')
  setPassword(@CurrentUser() user: AuthUser, @Body() dto: SetPasswordDto) {
    return this.auth.setPassword(user.id, dto.password);
  }
}
