import { ApiProperty, ApiPropertyOptional, OmitType, PartialType, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  AADHAAR_PATTERN,
  BLOOD_GROUPS,
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  EDUCATION_LEVELS,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  FAMILY_RELATIONSHIPS,
  GENDERS,
  IFSC_PATTERN,
  LIFECYCLE_ACTIONS,
  MARITAL_STATUSES,
  PAN_PATTERN,
  PASSPORT_PATTERN,
  UAN_PATTERN,
  type BloodGroup,
  type EducationLevel,
  type EmployeeStatus,
  type EmploymentType,
  type FamilyRelationship,
  type Gender,
  type LifecycleAction,
  type MaritalStatus,
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
  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() designationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() gradeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: EmploymentType;
}

export class CreateEmployeeDto {
  @ApiPropertyOptional({ nullable: true, description: 'Generated (EMP-0001…) when omitted' })
  @Transform(emptyToNullUpper)
  @optionalNullable
  @Matches(/^[A-Z0-9][A-Z0-9_/-]{0,29}$/, { message: 'employeeCode may contain letters, numbers, -, _ and / (max 30)' })
  employeeCode?: string | null;

  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) lastName!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(lowerEmail)
  @optionalNullable
  @IsEmail()
  @MaxLength(254)
  workEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(lowerEmail)
  @optionalNullable
  @IsEmail()
  @MaxLength(254)
  personalEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '1994-05-21' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsISO8601(DATE)
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsIn(GENDERS)
  gender?: Gender | null;

  @ApiProperty({ example: '2026-01-15' })
  @IsISO8601(DATE)
  dateOfJoining!: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: EmploymentType;

  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() designationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() locationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() managerId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Assigned shift; empty = the organization default' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsUUID()
  shiftId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Link to an existing user account in the organization' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsUUID()
  membershipId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsISO8601(DATE)
  probationEndDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(120)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @Matches(PHONE, { message: 'emergencyContactPhone must be a valid phone number' })
  emergencyContactPhone?: string | null;

  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() gradeId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() costCenterId?: string | null;

  @ApiPropertyOptional({ enum: MARITAL_STATUSES, nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsIn(MARITAL_STATUSES)
  maritalStatus?: MaritalStatus | null;

  @ApiPropertyOptional({ enum: BLOOD_GROUPS, nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: BloodGroup | null;

  @ApiPropertyOptional({ nullable: true, description: 'ISO 3166-1 alpha-2', example: 'IN' })
  @Transform(emptyToNullUpper)
  @optionalNullable
  @Matches(/^[A-Z]{2}$/, { message: 'nationality must be a 2-letter country code' })
  nationality?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(500)
  permanentAddress?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 365 })
  @Transform(({ value }) => (value === '' ? null : value))
  @optionalNullable
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  noticePeriodDays?: number | null;
}

/** Profile fields; placement (department, designation, location, manager, grade, cost center, status) changes go through lifecycle actions. */
export class UpdateEmployeeDto extends PartialType(OmitType(CreateEmployeeDto, ['departmentId', 'designationId', 'locationId', 'managerId', 'gradeId', 'costCenterId'] as const)) {}

/** Fields an employee may change on their own record (self.profile.update). */
export class UpdateMyEmployeeDto extends PartialType(
  PickType(CreateEmployeeDto, ['personalEmail', 'phone', 'address', 'permanentAddress', 'emergencyContactName', 'emergencyContactPhone', 'maritalStatus', 'bloodGroup'] as const),
) {}

export class CreateFromMembersDto {
  @ApiProperty({ type: [String], description: 'Organization users to create employee records for' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
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
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() gradeId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() costCenterId?: string | null;

  @ApiPropertyOptional({ enum: EMPLOYEE_STATUSES })
  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class SensitiveDetailsDto {
  @ApiPropertyOptional({ nullable: true, example: 'ABCDE1234F' })
  @Transform(emptyToNullUpper)
  @optionalNullable
  @Matches(PAN_PATTERN, { message: 'pan must look like ABCDE1234F' })
  pan?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @Matches(UAN_PATTERN, { message: 'uan must be 12 digits' })
  uan?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ESIC insurance (IP) number, 10 or 17 digits' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') || null : value))
  @optionalNullable
  @Matches(/^(\d{10}|\d{17})$/, { message: 'esiNumber must be 10 or 17 digits' })
  esiNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') || null : value))
  @optionalNullable
  @Matches(/^[0-9]{6,18}$/, { message: 'bankAccountNumber must be 6–18 digits' })
  bankAccountNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'HDFC0001234' })
  @Transform(emptyToNullUpper)
  @optionalNullable
  @Matches(IFSC_PATTERN, { message: 'bankIfsc must look like HDFC0001234' })
  bankIfsc?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(100)
  bankName?: string | null;

  @ApiPropertyOptional({ nullable: true, description: '12-digit Aadhaar number' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') || null : value))
  @optionalNullable
  @Matches(AADHAAR_PATTERN, { message: 'aadhaar must be a valid 12-digit Aadhaar number' })
  aadhaar?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNullUpper)
  @optionalNullable
  @Matches(PASSPORT_PATTERN, { message: 'passportNumber must be 6–12 letters and digits' })
  passportNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsISO8601(DATE)
  passportExpiry?: string | null;
}

/** Family member, education and previous-employment entries (owned by one employee). */
export class FamilyMemberDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) name!: string;

  @ApiProperty({ enum: FAMILY_RELATIONSHIPS })
  @IsIn(FAMILY_RELATIONSHIPS)
  relationship!: FamilyRelationship;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsISO8601(DATE)
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsIn(GENDERS)
  gender?: Gender | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDependent?: boolean;
}

export class EducationDto {
  @ApiProperty({ enum: EDUCATION_LEVELS })
  @IsIn(EDUCATION_LEVELS)
  level!: EducationLevel;

  @ApiProperty({ example: 'B.Tech' }) @Transform(trim) @IsString() @Length(1, 120) qualification!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(120)
  specialization?: string | null;

  @ApiProperty() @Transform(trim) @IsString() @Length(2, 200) institution!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => (value === '' ? null : value))
  @optionalNullable
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  startYear?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => (value === '' ? null : value))
  @optionalNullable
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  endYear?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Grade, percentage or CGPA' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(30)
  score?: string | null;
}

export class ExperienceDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) company!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) designation!: string;
  @ApiProperty({ example: '2020-06-01' }) @IsISO8601(DATE) startDate!: string;
  @ApiProperty({ example: '2023-12-31' }) @IsISO8601(DATE) endDate!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class UpdateFamilyMemberDto extends PartialType(FamilyMemberDto) {}
export class UpdateEducationDto extends PartialType(EducationDto) {}
export class UpdateExperienceDto extends PartialType(ExperienceDto) {}

export class OrgChartQueryDto {
  @ApiPropertyOptional({ description: 'Direct reports of this employee (default: the top of the visible hierarchy)' })
  @IsOptional()
  @IsUUID()
  managerId?: string;
}

/** Multipart fields sent with a document upload. */
export class UploadDocumentDto {
  @ApiProperty({ enum: DOCUMENT_CATEGORIES })
  @IsIn(DOCUMENT_CATEGORIES)
  category!: DocumentCategory;

  @ApiProperty() @Transform(trim) @IsString() @Length(2, 200) title!: string;

  @ApiPropertyOptional({ nullable: true, example: '2030-12-31' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsISO8601(DATE)
  expiryDate?: string | null;
}

export class UpdateDocumentDto extends PartialType(UploadDocumentDto) {}

export class ReviewBankChangeDto {
  @ApiPropertyOptional({ nullable: true, description: 'Required when rejecting' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED'])
  status!: 'VERIFIED' | 'REJECTED';

  @ApiPropertyOptional({ nullable: true, description: 'Required when rejecting' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ExpiringDocumentsQueryDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 365, default: 30, description: 'Include documents expiring within this many days (expired ones are always included)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  days?: number;
}

export class ImportEmployeesQueryDto {
  @ApiPropertyOptional({ description: 'true = validate only and report problems; nothing is saved' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  dryRun?: boolean;
}
