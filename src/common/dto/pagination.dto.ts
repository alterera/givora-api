import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  pageSize = 12;
}

export function pageArgs(query: PaginationQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 12;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
