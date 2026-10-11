import { IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AddressDto {
  @IsString()
  line1!: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsString()
  postalCode!: string;

  @IsString()
  countryCode!: string;
}

export class ClaimDto {
  @IsString()
  recipientName!: string;

  @IsString()
  phone!: string;

  @IsString()
  claimTicket!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

export class ClaimOtpDto {
  @IsOptional()
  @IsString()
  phone?: string;
}

export class ClaimOtpVerifyDto {
  @IsString()
  phone!: string;

  @IsString()
  @MinLength(6)
  code!: string;
}
