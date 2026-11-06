import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MODULE_KEYS, ORGANIZATION_STATUSES, OrganizationStatus } from '../../../contracts';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { OrganizationProfileDto } from '../../organizations/dto/organization.dto';
import { AuditLogQueryDto } from '../../audit/dto/audit-query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const NON_CORE_MODULES = MODULE_KEYS.filter((k) => k !== 'core');

export class PlatformOrganizationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ORGANIZATION_STATUSES })
  @IsOptional() @IsIn(ORGANIZATION_STATUSES)
  status?: OrganizationStatus;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  planId?: string;
}

class InitialAdminDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail() @MaxLength(254)
  email!: string;

  @ApiProperty()
  @Transform(trim) @IsString() @Length(1, 100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim) @IsString() @Length(1, 100)
  lastName!: string;
}

export class CreatePlatformOrganizationDto extends OrganizationProfileDto {
  @ApiProperty()
  @Transform(trim) @IsString() @Length(2, 200)
  declare name: string;

  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty({ type: InitialAdminDto })
  @ValidateNested() @Type(() => InitialAdminDto)
  admin!: InitialAdminDto;
}

export class UpdatePlatformOrganizationDto extends OrganizationProfileDto {
  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  planId?: string;
}

export class SuspendOrganizationDto {
  @ApiProperty()
  @Transform(trim) @IsString() @Length(3, 500)
  reason!: string;
}

class FeatureOverrideDto {
  @ApiProperty({ enum: NON_CORE_MODULES })
  @IsIn(NON_CORE_MODULES)
  featureKey!: string;

  @ApiProperty({ nullable: true, description: 'true = force enable, false = force disable, null = follow plan' })
  @ValidateIf((_o, v) => v !== null) @IsBoolean()
  enabled!: boolean | null;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  reason?: string;
}

export class SetFeatureOverridesDto {
  @ApiProperty({ type: [FeatureOverrideDto] })
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => FeatureOverrideDto)
  overrides!: FeatureOverrideDto[];
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'null = unlimited' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(1_000_000)
  maxUsers?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  monthlyPrice?: number | null;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional() @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(0) @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({ enum: NON_CORE_MODULES, isArray: true })
  @IsOptional() @IsArray() @IsIn(NON_CORE_MODULES, { each: true })
  featureKeys?: string[];
}

export class CreatePlanDto extends UpdatePlanDto {
  @ApiProperty({ example: 'growth' })
  @Matches(/^[a-z0-9][a-z0-9_-]{1,49}$/, { message: 'code must be lowercase letters, digits, - or _' })
  code!: string;

  @ApiProperty()
  @Transform(trim) @IsString() @Length(2, 100)
  declare name: string;
}

export class PlatformAuditQueryDto extends AuditLogQueryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  organizationId?: string;
}
