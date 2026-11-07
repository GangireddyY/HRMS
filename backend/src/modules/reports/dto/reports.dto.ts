import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { REPORT_EXPORT_FORMATS, type ReportExportFormat } from '../../../contracts';

const DATE = { strict: true, strictSeparator: true };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ReportQueryDto {
  @ApiPropertyOptional({ example: '2026-11-06', description: 'Headcount: the day to report on (default today)' }) @IsOptional() @IsISO8601(DATE) asOf?: string;
  @ApiPropertyOptional({ example: '2026-04-01', description: 'Attrition, leave, recruitment: start of the period' }) @IsOptional() @IsISO8601(DATE) from?: string;
  @ApiPropertyOptional({ example: '2026-11-06' }) @IsOptional() @IsISO8601(DATE) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ example: '2025-12', description: 'Payroll cost: first month (YYYY-MM)' }) @IsOptional() @Matches(MONTH, { message: 'fromMonth must be YYYY-MM' }) fromMonth?: string;
  @ApiPropertyOptional({ example: '2026-11' }) @IsOptional() @Matches(MONTH, { message: 'toMonth must be YYYY-MM' }) toMonth?: string;
}

export class ReportExportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: REPORT_EXPORT_FORMATS, default: 'csv' }) @IsOptional() @IsIn(REPORT_EXPORT_FORMATS) format?: ReportExportFormat;
}
