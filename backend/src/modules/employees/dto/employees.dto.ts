import { ApiProperty, ApiPropertyOptional, OmitType, PartialType, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  GENDERS,
  IFSC_PATTERN,
  LIFECYCLE_ACTIONS,
  PAN_PATTERN,
  UAN_PATTERN,
  type EmployeeStatus,
  type EmploymentType,
  type Gender,
  type LifecycleAction,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, emptyToNullUpper, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const lowerEmail = ({ value }: { value: unknown }) => {
  const v = emptyToNull({ value });
  return typeof v === 'string' ? v.toLowerCase() : v;
};

export class EmployeeListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EMPLOYEE_STATUSES })
  @IsOptional() @IsIn(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() designationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional() @IsIn(EMPLOYMENT_TYPES)
  employmentType?: EmploymentType;
}

export class CreateEmployeeDto {
  @ApiPropertyOptional({ nullable: true, description: 'Generated (EMP-0001…) when omitted' })
  @Transform(emptyToNullUpper) @optionalNullable @Matches(/^[A-Z0-9][A-Z0-9_/-]{0,29}$/, { message: 'employeeCode may contain letters, numbers, -, _ and / (max 30)' })
  employeeCode?: string | null;

  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) lastName!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(lowerEmail) @optionalNullable @IsEmail() @MaxLength(254)
  workEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(lowerEmail) @optionalNullable @IsEmail() @MaxLength(254)
  personalEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '1994-05-21' })
  @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE)
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsIn(GENDERS)
  gender?: Gender | null;

  @ApiProperty({ example: '2026-01-15' })
  @IsISO8601(DATE)
  dateOfJoining!: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional() @IsIn(EMPLOYMENT_TYPES)
  employmentType?: EmploymentType;

  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() designationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() locationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() managerId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Assigned shift; empty = the organization default' })
  @Transform(emptyToNull) @optionalNullable @IsUUID()
  shiftId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Link to an existing user account in the organization' })
  @Transform(emptyToNull) @optionalNullable @IsUUID()
  membershipId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE)
  probationEndDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(120)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @Matches(PHONE, { message: 'emergencyContactPhone must be a valid phone number' })
  emergencyContactPhone?: string | null;
}

/** Profile fields; placement (department, designation, location, manager, status) changes go through lifecycle actions. */
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['departmentId', 'designationId', 'locationId', 'managerId'] as const),
) {}

/** Fields an employee may change on their own record (self.profile.update). */
export class UpdateMyEmployeeDto extends PartialType(
  PickType(CreateEmployeeDto, ['personalEmail', 'phone', 'address', 'emergencyContactName', 'emergencyContactPhone'] as const),
) {}

export class CreateFromMembersDto {
  @ApiProperty({ type: [String], description: 'Organization users to create employee records for' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('all', { each: true })
  membershipIds!: string[];
}

export class LifecycleActionDto {
  @ApiProperty({ enum: LIFECYCLE_ACTIONS })
  @IsIn(LIFECYCLE_ACTIONS)
  type!: LifecycleAction;

  @ApiProperty({ example: '2026-11-01' })
  @IsISO8601(DATE)
  effectiveDate!: string;

  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() designationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() locationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() managerId?: string | null;

  @ApiPropertyOptional({ enum: EMPLOYEE_STATUSES })
  @IsOptional() @IsIn(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500)
  note?: string | null;
}

export class SensitiveDetailsDto {
  @ApiPropertyOptional({ nullable: true, example: 'ABCDE1234F' })
  @Transform(emptyToNullUpper) @optionalNullable @Matches(PAN_PATTERN, { message: 'pan must look like ABCDE1234F' })
  pan?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @Matches(UAN_PATTERN, { message: 'uan must be 12 digits' })
  uan?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') || null : value)) @optionalNullable @Matches(/^[0-9]{6,18}$/, { message: 'bankAccountNumber must be 6–18 digits' })
  bankAccountNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'HDFC0001234' })
  @Transform(emptyToNullUpper) @optionalNullable @Matches(IFSC_PATTERN, { message: 'bankIfsc must look like HDFC0001234' })
  bankIfsc?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100)
  bankName?: string | null;
}
