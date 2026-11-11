import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  BUILDER_DATASETS,
  BUILDER_MAX_COLUMNS,
  BUILDER_OPERATORS,
  REPORT_FREQUENCIES,
  REPORT_MAX_MONTH_DAY,
  REPORT_MAX_RECIPIENTS,
  REPORT_PERIODS,
  type BuilderDataset,
  type BuilderOperator,
  type ReportFrequency,
  type ReportPeriod,
} from '../../../contracts';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };

export class BuilderFilterDto {
  @ApiProperty() @IsString() @MaxLength(60) column!: string;
  @ApiProperty({ enum: BUILDER_OPERATORS }) @IsIn(BUILDER_OPERATORS) op!: BuilderOperator;
  @ApiPropertyOptional({ description: 'A value, or a list for "in"' }) @IsOptional() value?: string | number | boolean | string[] | null;
}

export class BuilderSortDto {
  @ApiProperty() @IsString() @MaxLength(60) column!: string;
  @ApiProperty({ enum: ['asc', 'desc'] }) @IsIn(['asc', 'desc']) direction!: 'asc' | 'desc';
}

export class BuilderQueryDto {
  @ApiProperty({ enum: BUILDER_DATASETS }) @IsIn(BUILDER_DATASETS) dataset!: BuilderDataset;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BUILDER_MAX_COLUMNS) @ArrayUnique() @IsString({ each: true }) columns!: string[];
  @ApiPropertyOptional({ type: [BuilderFilterDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BuilderFilterDto) filters?: BuilderFilterDto[];
  @ApiPropertyOptional({ type: BuilderSortDto, nullable: true }) @optionalNullable @ValidateNested() @Type(() => BuilderSortDto) sort?: BuilderSortDto | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(60) groupBy?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601(DATE) to?: string;
}

export class BuilderExportDto extends BuilderQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'xlsx'], default: 'csv' }) @IsOptional() @IsIn(['csv', 'xlsx']) format?: 'csv' | 'xlsx';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 120) title?: string;
}

export class ReportScheduleDto {
  @ApiProperty() @IsUUID() savedReportId!: string;
  @ApiProperty({ enum: REPORT_FREQUENCIES }) @IsIn(REPORT_FREQUENCIES) frequency!: ReportFrequency;
  @ApiPropertyOptional({ nullable: true, description: 'Weekly: ISO weekday, 1 = Monday' }) @optionalNullable @IsInt() @Min(1) @Max(7) dayOfWeek?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Monthly: day 1 to 28' }) @optionalNullable @IsInt() @Min(1) @Max(REPORT_MAX_MONTH_DAY) dayOfMonth?: number | null;
  @ApiProperty({ description: "Local hour in the organization's timezone" }) @IsInt() @Min(0) @Max(23) hour!: number;
  @ApiProperty({ enum: ['csv', 'xlsx'] }) @IsIn(['csv', 'xlsx']) format!: 'csv' | 'xlsx';
  @ApiProperty({ enum: REPORT_PERIODS }) @IsIn(REPORT_PERIODS) period!: ReportPeriod;
  @ApiProperty({ type: [String], description: 'Members of the organization (user ids)' }) @IsArray() @ArrayMaxSize(REPORT_MAX_RECIPIENTS) @IsUUID('all', { each: true }) recipientIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SaveReportDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional({ description: 'Listed for everyone who may see the dataset' }) @IsOptional() @IsBoolean() shared?: boolean;
  @ApiProperty({ type: BuilderQueryDto }) @IsDefined() @ValidateNested() @Type(() => BuilderQueryDto) query!: BuilderQueryDto;
}
