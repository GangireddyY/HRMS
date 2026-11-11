import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDefined, IsIn, IsISO8601, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { BUILDER_DATASETS, BUILDER_MAX_COLUMNS, BUILDER_OPERATORS, type BuilderDataset, type BuilderOperator } from '../../../contracts';
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

export class SaveReportDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional({ description: 'Listed for everyone who may see the dataset' }) @IsOptional() @IsBoolean() shared?: boolean;
  @ApiProperty({ type: BuilderQueryDto }) @IsDefined() @ValidateNested() @Type(() => BuilderQueryDto) query!: BuilderQueryDto;
}
