import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class LoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  password!: string;
}

export class OtpRequestDto {
  @IsString()
  phone!: string;
}

export class OtpVerifyDto {
  @IsString()
  phone!: string;

  @IsString()
  @MinLength(6)
  code!: string;
}

export class EmailTokenDto {
  @IsString()
  token!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class SetPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

export class EmptyDto {
  @IsOptional()
  @IsBoolean()
  unused?: boolean;
}
