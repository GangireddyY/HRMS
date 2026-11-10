import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_ALLOWED_NETWORKS } from '../../../contracts';
import { emptyToNull, emptyToNullUpper, optionalNullable, trim } from '../../../common/validation/transforms';
import { IsTimeZone } from '../../../common/validation/validators';

const CODE = /^[A-Za-z0-9_-]{1,30}$/;

export class CreateDepartmentDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNullUpper) @optionalNullable @Matches(CODE, { message: 'code may contain letters, numbers, - and _ (max 30)' })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class CreateDesignationDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 50 })
  @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(50)
  level?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
export class UpdateDesignationDto extends PartialType(CreateDesignationDto) {}

export class CreateLocationDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNullUpper) @optionalNullable @Matches(CODE, { message: 'code may contain letters, numbers, - and _ (max 30)' })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200)
  addressLine1?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100)
  state?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ISO 3166-1 alpha-2' })
  @Transform(emptyToNullUpper) @optionalNullable @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter ISO code' })
  country?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsTimeZone()
  timezone?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Office position for the punch geofence' })
  @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  longitude?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Web punch-ins further away than this (metres) are refused, except on work-from-home days' })
  @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsInt() @Min(25) @Max(50000)
  geofenceRadiusM?: number | null;

  @ApiPropertyOptional({ type: [String], nullable: true, description: 'Office networks (IP addresses or CIDR ranges) web punch-ins must come from; empty = anywhere. Work-from-home days are exempt.' })
  @Transform(({ value }) => (Array.isArray(value) && !value.length ? null : value))
  @optionalNullable
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_NETWORKS)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  allowedNetworks?: string[] | null;

  @ApiPropertyOptional({ description: 'Web punch-ins need a photo taken with the camera' })
  @IsOptional() @IsBoolean()
  punchPhotoRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
export class UpdateLocationDto extends PartialType(CreateLocationDto) {}

export class CreateGradeDto {
  @Transform(trim) @IsString() @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNullUpper) @optionalNullable @Matches(CODE, { message: 'code may contain letters, numbers, - and _ (max 30)' })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 50, description: '1 = most junior' })
  @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(50)
  level?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
export class UpdateGradeDto extends PartialType(CreateGradeDto) {}

export class CreateCostCenterDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString() @Matches(CODE, { message: 'code may contain letters, numbers, - and _ (max 30)' })
  code!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
export class UpdateCostCenterDto extends PartialType(CreateCostCenterDto) {}
