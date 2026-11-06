import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { COMPLIANCE_CATEGORIES, EMPLOYMENT_TYPES, POLICY_CATEGORIES, POLICY_STATUSES, type ComplianceCategory, type EmploymentType, type PolicyCategory, type PolicyStatus } from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const Ids = (max: number) => applyDecorators(optionalNullable, IsArray(), ArrayMaxSize(max), ArrayUnique(), IsUUID('4', { each: true }));
const Text = (max: number) => applyDecorators(Transform(emptyToNull), optionalNullable, IsString(), MaxLength(max));
const queryBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

// ---- Policies ----------------------------------------------------------------------------------

export class PolicyDto {
  @ApiProperty({ example: 'Code of conduct' }) @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiProperty({ enum: POLICY_CATEGORIES }) @IsIn(POLICY_CATEGORIES) category!: PolicyCategory;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) summary?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Person responsible for the policy' }) @Transform(emptyToNull) @optionalNullable @IsUUID() ownerUserId?: string | null;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(200) departmentIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(200) locationIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true, enum: EMPLOYMENT_TYPES, isArray: true })
  @optionalNullable
  @IsArray()
  @ArrayUnique()
  @IsIn(EMPLOYMENT_TYPES, { each: true })
  employmentTypes?: EmploymentType[] | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() requiresAck?: boolean;
  @ApiPropertyOptional({ default: 14, description: 'Days employees have to acknowledge it' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) ackDueDays?: number;
  @ApiPropertyOptional({ nullable: true, description: 'Review every this many months' }) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(60) reviewMonths?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Text of the first version' }) @Text(200000) content?: string | null;
}

export class UpdatePolicyDto extends PartialType(PolicyDto) {}

export class PolicyQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: POLICY_STATUSES }) @IsOptional() @IsIn(POLICY_STATUSES) status?: PolicyStatus;
  @ApiPropertyOptional({ enum: POLICY_CATEGORIES }) @IsOptional() @IsIn(POLICY_CATEGORIES) category?: PolicyCategory;
}

export class PolicyDraftDto {
  @ApiPropertyOptional({ nullable: true }) @Text(200000) content?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'What changed (shown to employees)' }) @Text(1000) changeSummary?: string | null;
  @ApiPropertyOptional({ description: 'Everyone acknowledges this version again (a material change)' }) @IsOptional() @IsBoolean() reacknowledge?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) effectiveFrom?: string | null;
}

export class AcknowledgeDto {
  @ApiProperty({ description: 'The version that was read' }) @IsUUID() versionId!: string;
}

export class TrackingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ACKNOWLEDGED', 'PENDING', 'OVERDUE'] }) @IsOptional() @IsIn(['ACKNOWLEDGED', 'PENDING', 'OVERDUE']) state?: 'ACKNOWLEDGED' | 'PENDING' | 'OVERDUE';
}

// ---- Calendar ----------------------------------------------------------------------------------

export class ObligationDto {
  @ApiProperty({ example: 'PF contributions and ECR' }) @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiProperty({ enum: COMPLIANCE_CATEGORIES }) @IsIn(COMPLIANCE_CATEGORIES) category!: ComplianceCategory;
  @ApiPropertyOptional({ nullable: true }) @Text(150) authority?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(2000) description?: string | null;
  @ApiProperty({ type: [String], example: ['01-15', '02-15'], description: 'Due dates each year as MM-DD' }) @IsArray() @ArrayMaxSize(24) @IsString({ each: true }) dueDates!: string[];
  @ApiProperty({ example: '2026-04-01' }) @IsISO8601(DATE) startsOn!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) endsOn?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() ownerUserId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateObligationDto extends PartialType(ObligationDto) {}

export class CalendarQueryDto {
  @ApiProperty({ example: '2026-11-01' }) @IsISO8601(DATE) from!: string;
  @ApiProperty({ example: '2027-01-31' }) @IsISO8601(DATE) to!: string;
  @ApiPropertyOptional({ description: 'Include overdue filings from before the range' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() overdue?: boolean;
}

export class FilingDto {
  @ApiProperty({ description: 'The due date being filed' }) @IsISO8601(DATE) dueOn!: string;
  @ApiProperty({ description: 'When it was filed / paid' }) @IsISO8601(DATE) completedOn!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Challan, acknowledgement or receipt number' }) @Text(120) reference?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) note?: string | null;
}
