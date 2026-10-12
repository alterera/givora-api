import { IsOptional, IsString } from 'class-validator';

export class RedeemDto {
  @IsOptional()
  @IsString()
  addressId?: string;

  @IsOptional()
  @IsString()
  line1?: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;
}

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

  @IsOptional()
  @IsString()
  label?: string;
}

export class ShipmentStatusDto {
  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class TrackingDto {
  @IsString()
  carrier!: string;

  @IsString()
  trackingRef!: string;
}
