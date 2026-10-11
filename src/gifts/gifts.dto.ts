import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class GiftItemDto {
  @IsString()
  variantId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateGiftDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GiftItemDto)
  items!: GiftItemDto[];

  @IsString()
  @MaxLength(500)
  message!: string;

  @IsString()
  @MaxLength(80)
  senderDisplayName!: string;

  @IsBoolean()
  isAnonymous!: boolean;

  @IsIn(['cinematic', 'playful'])
  revealTheme!: 'cinematic' | 'playful';

  @IsOptional()
  @IsString()
  recipientNameHint?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;
}

export class PatchGiftDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsString()
  senderDisplayName?: string;

  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @IsOptional()
  @IsIn(['cinematic', 'playful'])
  revealTheme?: 'cinematic' | 'playful';

  @IsOptional()
  @IsString()
  recipientNameHint?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;
}

export class CheckoutDto {
  @IsOptional()
  @IsString()
  phone?: string;
}
