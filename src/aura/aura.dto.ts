import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AuraAdminAdjustDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsInt()
  amount!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
