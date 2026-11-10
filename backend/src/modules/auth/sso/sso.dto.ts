import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DOMAIN = /^@?([a-z0-9-]+\.)+[a-z]{2,63}$/i;

export class SsoConfigDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ example: 'https://login.microsoftonline.com/<tenant-id>/v2.0' }) @Transform(trim) @IsString() @Length(8, 500) issuer!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 300) clientId!: string;
  @ApiPropertyOptional({ description: 'Leave empty to keep the stored secret' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) clientSecret?: string | null;
  @ApiPropertyOptional({ description: 'The provider issues no client secret (public client with PKCE)' }) @IsOptional() @IsBoolean() publicClient?: boolean;
  @ApiProperty({ type: [String], example: ['acme.com'] })
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Matches(DOMAIN, { each: true, message: 'Enter email domains like acme.com' }) emailDomains!: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoProvision?: boolean;
  @ApiPropertyOptional({ default: 'employee' }) @IsOptional() @IsString() @MaxLength(60) defaultRoleKey?: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(60) buttonLabel?: string | null;
}

export class SsoDiscoverDto {
  @ApiProperty() @Transform(trim) @IsEmail() email!: string;
}
