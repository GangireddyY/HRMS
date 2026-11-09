import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { LOG_ARCHIVE_KINDS, type LogArchiveKind } from '../../../contracts';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class LogArchiveListDto {
  @ApiPropertyOptional({ enum: LOG_ARCHIVE_KINDS }) @IsOptional() @IsIn(LOG_ARCHIVE_KINDS) kind?: LogArchiveKind;
}

export class CreateLogArchiveDto {
  @ApiProperty({ enum: LOG_ARCHIVE_KINDS }) @IsIn(LOG_ARCHIVE_KINDS) kind!: LogArchiveKind;
  @ApiProperty({ example: '2026-08-01', description: "Records created before this day (organization's time zone)" })
  @Matches(DATE, { message: 'before must be a date like 2026-08-01' })
  before!: string;
}

export class PurgeLogArchiveDto {
  @ApiProperty({ description: 'The number of archived records, typed to confirm' }) @Type(() => Number) @IsInt() @Min(1) recordCount!: number;
}
