import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class LoginDto {
  @ApiProperty({ example: 'admin@acme.test' })
  @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ description: 'Preferred organization (membership is validated)' })
  @IsOptional() @IsUUID()
  organizationId?: string;
}

export class MfaVerifyDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  challengeToken!: string;

  @ApiPropertyOptional({ description: '6-digit authenticator code' })
  @ValidateIf((o: MfaVerifyDto) => !o.recoveryCode)
  @IsString() @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code?: string;

  @ApiPropertyOptional({ description: 'One-time recovery code' })
  @ValidateIf((o: MfaVerifyDto) => !o.code)
  @IsString() @Length(12, 20)
  recoveryCode?: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString() @Length(20, 200)
  token!: string;

  @ApiProperty()
  @IsString() @MaxLength(128)
  password!: string;
}

export class InspectTokenDto {
  @ApiProperty()
  @IsString() @Length(20, 200)
  token!: string;

  @ApiProperty({ enum: ['PASSWORD_RESET', 'INVITATION'] })
  @IsIn(['PASSWORD_RESET', 'INVITATION'])
  purpose!: 'PASSWORD_RESET' | 'INVITATION';
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString() @Length(20, 200)
  token!: string;

  @ApiProperty({ description: 'New password, or current password for existing accounts' })
  @IsString() @MaxLength(128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  lastName?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(128)
  currentPassword!: string;

  @ApiProperty()
  @IsString() @MaxLength(128)
  newPassword!: string;
}

export class SwitchOrganizationDto {
  @ApiProperty()
  @IsUUID()
  organizationId!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(trim) @ValidateIf((_o, v) => v !== null && v !== '')
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'phone must be a valid phone number' })
  phone?: string | null;
}

const PREFERENCE_VALUE = /^[A-Za-z0-9-]{1,20}$/;
const nullablePreference = ValidateIf((_o, v) => v !== null && v !== undefined);

/** Appearance choices; each is a short catalog key (e.g. `dark`, `teal`, `en-IN`). Null removes a choice. */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({ nullable: true, example: 'dark' })
  @nullablePreference @IsString() @Matches(PREFERENCE_VALUE)
  mode?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'teal' })
  @nullablePreference @IsString() @Matches(PREFERENCE_VALUE)
  color?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'light' })
  @nullablePreference @IsString() @Matches(PREFERENCE_VALUE)
  sidebar?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'en-IN' })
  @nullablePreference @IsString() @Matches(PREFERENCE_VALUE)
  region?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'h23' })
  @nullablePreference @IsString() @Matches(PREFERENCE_VALUE)
  hourCycle?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'ltr' })
  @nullablePreference @IsString() @Matches(PREFERENCE_VALUE)
  direction?: string | null;
}

export class MfaCodeDto {
  @ApiProperty()
  @IsString() @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class MfaDisableDto extends MfaCodeDto {
  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(128)
  password!: string;
}

class RegisterOrganizationDetailsDto {
  @ApiProperty()
  @Transform(trim) @IsString() @Length(2, 200)
  name!: string;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code' })
  country?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional() @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({ enum: ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'] })
  @IsOptional() @IsIn(['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'])
  companySize?: string;
}

class RegisterAdminDto {
  @ApiProperty()
  @Transform(trim) @IsString() @Length(1, 100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim) @IsString() @Length(1, 100)
  lastName!: string;

  @ApiProperty()
  @Transform(normalizeEmail) @IsEmail() @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString() @MaxLength(128)
  password!: string;
}

export class RegisterOrganizationDto {
  @ApiProperty({ type: RegisterOrganizationDetailsDto })
  @ValidateNested() @Type(() => RegisterOrganizationDetailsDto)
  organization!: RegisterOrganizationDetailsDto;

  @ApiProperty({ type: RegisterAdminDto })
  @ValidateNested() @Type(() => RegisterAdminDto)
  admin!: RegisterAdminDto;
}
