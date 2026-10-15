import { IsOptional, IsString } from 'class-validator';

export class StreakCheckoutDto {
  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
