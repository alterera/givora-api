import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class OrderLineDto {
  @IsString()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsString()
  creatorId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(['web', 'telegram'])
  channel?: 'web' | 'telegram';
}

export class CheckoutOrderDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(['web', 'telegram'])
  channel?: 'web' | 'telegram';
}
