import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { COUNTRY_PATTERN, CURRENCY_PATTERN, MAX_REGISTRATIONS } from '../../contracts';
import { emptyToNull, optionalNullable, trim } from '../../common/validation/transforms';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class RegistrationDto {
  @ApiProperty({ example: 'GSTIN' }) @Transform(trim) @IsString() @Length(1, 40) label!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) value!: string;
}

export class LegalEntityDto {
  @ApiProperty({ example: 'Acme India' }) @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ example: 'Acme Software India Private Limited' }) @Transform(trim) @IsString() @Length(2, 200) legalName!: string;
  @ApiProperty({ example: 'IN' }) @Transform(upper) @Matches(COUNTRY_PATTERN, { message: 'country must be an ISO 3166-1 alpha-2 code' }) country!: string;
  @ApiProperty({ example: 'INR' }) @Transform(upper) @Matches(CURRENCY_PATTERN, { message: 'currency must be an ISO 4217 code' }) currency!: string;
  @ApiPropertyOptional({ type: [RegistrationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(MAX_REGISTRATIONS) @ValidateNested({ each: true }) @Type(() => RegistrationDto) registrations?: RegistrationDto[];
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200) addressLine1?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200) addressLine2?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100) city?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100) state?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(20) postalCode?: string | null;
  @ApiPropertyOptional({ description: 'The entity for anyone not assigned to another one' }) @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class AssignEntityDto {
  @ApiPropertyOptional({ nullable: true, description: 'Null = the default entity' }) @optionalNullable @IsUUID() legalEntityId!: string | null;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID('all', { each: true }) employeeIds!: string[];
}

export class ExchangeRateDto {
  @ApiProperty({ example: 'USD' }) @Transform(upper) @Matches(CURRENCY_PATTERN, { message: 'currency must be an ISO 4217 code' }) currency!: string;
  @ApiProperty({ example: 83.25, description: 'Base-currency units for one unit of the currency' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 8 }) @Min(0.00000001) @Max(1_000_000) rate!: number;
  @ApiProperty({ example: '2026-11-01' }) @IsISO8601({ strict: true, strictSeparator: true }) effectiveOn!: string;
  @ApiPropertyOptional({ nullable: true, example: 'RBI reference rate' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(120) source?: string | null;
}
