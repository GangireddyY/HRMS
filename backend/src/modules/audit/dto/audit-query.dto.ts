import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Op } from 'sequelize';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'role.permissions_updated' })
  @IsOptional() @IsString() @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: 'Role' })
  @IsOptional() @IsString() @MaxLength(100)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional() @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive)' })
  @IsOptional() @IsISO8601()
  to?: string;
}

export class LoginEventQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['SUCCESS', 'FAILURE', 'MFA_CHALLENGE', 'LOCKED'] })
  @IsOptional() @IsIn(['SUCCESS', 'FAILURE', 'MFA_CHALLENGE', 'LOCKED'])
  outcome?: 'SUCCESS' | 'FAILURE' | 'MFA_CHALLENGE' | 'LOCKED';

  @ApiPropertyOptional()
  @IsOptional() @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsISO8601()
  to?: string;
}

/** Builds an inclusive createdAt range (Sequelize operators); a date-only `to` covers the whole day. */
export function dateRange(from?: string, to?: string): { [Op.gte]?: Date; [Op.lte]?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { [Op.gte]?: Date; [Op.lte]?: Date } = {};
  if (from) range[Op.gte] = new Date(from);
  if (to) {
    const end = new Date(to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999);
    range[Op.lte] = end;
  }
  return range;
}
