import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsTimeZone } from '../../../common/validation/validators';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Empty strings clear optional fields. */
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value);
const optionalNullable = ValidateIf((_o, v) => v !== null && v !== undefined);

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'] as const;
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY'] as const;

/** Organization profile fields shared by tenant settings and platform administration. */
export class OrganizationProfileDto {
  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @Length(2, 200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200)
  legalName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100)
  industry?: string | null;

  @ApiPropertyOptional({ enum: COMPANY_SIZES, nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsIn(COMPANY_SIZES)
  companySize?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsEmail() @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(255)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(50)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(50)
  taxId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200)
  addressLine1?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200)
  addressLine2?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100)
  state?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(20)
  postalCode?: string | null;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code' })
  country?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional() @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional() @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency?: string;

  @ApiPropertyOptional({ example: 'en-IN' })
  @IsOptional() @Matches(/^[a-z]{2}(-[A-Z]{2})?$/, { message: 'locale must look like en or en-IN' })
  locale?: string;

  @ApiPropertyOptional({ enum: DATE_FORMATS })
  @IsOptional() @IsIn(DATE_FORMATS)
  dateFormat?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12)
  fiscalYearStartMonth?: number;
}

export class UpdateSecurityPolicyDto {
  @ApiPropertyOptional({ minimum: 8, maximum: 128 })
  @IsOptional() @IsInt() @Min(8) @Max(128)
  passwordMinLength?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  passwordRequireUppercase?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  passwordRequireLowercase?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  passwordRequireNumber?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  passwordRequireSymbol?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 24 })
  @IsOptional() @IsInt() @Min(0) @Max(24)
  passwordHistoryCount?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 365, description: '0 = never expires' })
  @IsOptional() @IsInt() @Min(0) @Max(365)
  passwordMaxAgeDays?: number;

  @ApiPropertyOptional({ minimum: 3, maximum: 20 })
  @IsOptional() @IsInt() @Min(3) @Max(20)
  lockoutThreshold?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440 })
  @IsOptional() @IsInt() @Min(1) @Max(1440)
  lockoutDurationMinutes?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 1440 })
  @IsOptional() @IsInt() @Min(5) @Max(1440)
  sessionIdleTimeoutMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 720 })
  @IsOptional() @IsInt() @Min(1) @Max(720)
  sessionMaxLifetimeHours?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  mfaRequired?: boolean;
}
