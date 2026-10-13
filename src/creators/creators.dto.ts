import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ApplyCreatorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  displayName!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  giftNote?: string;

  @IsOptional()
  @IsString()
  personaDisclosure?: string;
}

export class PatchCreatorDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  giftNote?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  personaDisclosure?: string;
}

export class WishlistAddDto {
  @IsString()
  variantId!: string;
}

export class WishlistPatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

export class CreatorStatusDto {
  @IsString()
  status!: 'PENDING' | 'APPROVED' | 'SUSPENDED';
}

export class PromoteCreatorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  displayName!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
}
