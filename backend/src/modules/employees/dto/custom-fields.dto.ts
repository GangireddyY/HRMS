import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { CUSTOM_FIELD_KEY_PATTERN, CUSTOM_FIELD_TYPES, type CustomFieldType } from '../../../contracts';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const trimAll = ({ value }: { value: unknown }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '') : value);

export class CustomFieldDefinitionDto {
  @ApiProperty({ example: 'blood_donor' }) @Matches(CUSTOM_FIELD_KEY_PATTERN, { message: 'Use lowercase letters, digits and underscores, starting with a letter' }) key!: string;
  @ApiProperty({ example: 'Blood donor' }) @Transform(trim) @IsString() @Length(2, 80) label!: string;
  @ApiProperty({ enum: CUSTOM_FIELD_TYPES }) @IsIn(CUSTOM_FIELD_TYPES) type!: CustomFieldType;
  @ApiPropertyOptional({ type: [String], description: 'Choices for SELECT and MULTI_SELECT' })
  @IsOptional() @Transform(trimAll) @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsString({ each: true }) @Length(1, 80, { each: true }) options?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional({ description: 'Only people who see bank and statutory identifiers (and the employee) see the value' }) @IsOptional() @IsBoolean() sensitive?: boolean;
  @ApiPropertyOptional({ description: 'The employee can fill it in from their profile' }) @IsOptional() @IsBoolean() employeeEditable?: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'Personal' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(60) section?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200) helpText?: string | null;
}

export class UpdateCustomFieldDefinitionDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) label?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @Transform(trimAll) @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsString({ each: true }) @Length(1, 80, { each: true }) options?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sensitive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() employeeEditable?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(60) section?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200) helpText?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional({ description: 'Archive (hide) the field; its values are kept' }) @IsOptional() @IsBoolean() archived?: boolean;
}

export class CustomFieldValuesDto {
  @ApiProperty({ example: { blood_donor: true, t_shirt_size: 'M' }, description: 'Values by field key; null clears a value' }) @IsObject() values!: Record<string, unknown>;
}
