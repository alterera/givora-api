import { IsIn, IsOptional, IsString } from 'class-validator';

export class CosmeticCheckoutDto {
  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class CosmeticUnequipDto {
  @IsIn(['FRAME', 'EFFECT'])
  kind!: 'FRAME' | 'EFFECT';
}
