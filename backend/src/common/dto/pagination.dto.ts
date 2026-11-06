import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { PaginationMeta } from '../../contracts';
import { AppError } from '../errors/app-error';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ description: 'field:asc | field:desc', example: 'createdAt:desc' })
  @IsOptional() @IsString() @Matches(/^[a-zA-Z]+:(asc|desc)$/, { message: 'sort must be formatted as field:asc or field:desc' })
  sort?: string;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional() @IsString() @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}

export function paginationArgs(q: PaginationQueryDto): { offset: number; limit: number } {
  return { offset: (q.page - 1) * q.pageSize, limit: q.pageSize };
}

export function paginationMeta(q: PaginationQueryDto, total: number): PaginationMeta {
  return { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

/**
 * Resolves a `field:dir` sort string against an explicit whitelist of sortable fields.
 * Each whitelist entry maps a public field name to a Sequelize `order` builder.
 */
export function resolveSort<T>(
  sort: string | undefined,
  allowed: Record<string, (dir: 'asc' | 'desc') => T>,
  fallback: T,
): T {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':') as [string, 'asc' | 'desc'];
  const builder = allowed[field];
  if (!builder) {
    throw AppError.validation([{ field: 'sort', message: `Cannot sort by "${field}". Allowed: ${Object.keys(allowed).join(', ')}` }]);
  }
  return builder(dir);
}
