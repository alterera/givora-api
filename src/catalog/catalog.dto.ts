import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PaginationQuery } from '../common/dto/pagination.dto.js';

export class ProductQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  occasion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPaise?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPaise?: number;
}

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  slug!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  story?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  occasionId?: string;

  @IsOptional()
  @IsString()
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  story?: string;

  @IsOptional()
  @IsString()
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  occasionId?: string;
}

export class CreateVariantDto {
  @IsString()
  sku!: string;

  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  pricePaise!: number;

  @IsOptional()
  @IsInt()
  compareAtPaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  onHand?: number;
}

export class StockAdjustDto {
  @IsInt()
  delta!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}

export class RegisterImageDto {
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  alt?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class PresignDto {
  @IsString()
  fileName!: string;

  @IsString()
  contentType!: string;
}

export class CategoryDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
