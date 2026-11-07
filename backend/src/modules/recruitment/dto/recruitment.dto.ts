import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  APPLICATION_STAGES,
  CANDIDATE_SKILLS_MAX,
  CANDIDATE_SOURCES,
  EMPLOYMENT_TYPES,
  FEEDBACK_RECOMMENDATIONS,
  INTERVIEW_MODES,
  JOB_STATUSES,
  REQUISITION_REASONS,
  REQUISITION_STATUSES,
  type ApplicationStage,
  type CandidateSource,
  type EmploymentType,
  type FeedbackRecommendation,
  type InterviewMode,
  type JobStatus,
  type RequisitionReason,
  type RequisitionStatus,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
/** Trimmed, without blanks or case-insensitive duplicates. */
const skillList = ({ value }: { value: unknown }) => {
  if (!Array.isArray(value)) return value;
  const seen = new Map<unknown, unknown>();
  for (const v of value) {
    const s = typeof v === 'string' ? v.trim() : v;
    if (s !== '' && !seen.has(typeof s === 'string' ? s.toLowerCase() : s)) seen.set(typeof s === 'string' ? s.toLowerCase() : s, s);
  }
  return [...seen.values()];
};
/** Optional, nullable amount with up to two decimals. */
const Money = () => applyDecorators(Transform(({ value }) => (value === '' ? null : value)), optionalNullable, Type(() => Number), IsNumber({ maxDecimalPlaces: 2 }), Min(0), Max(1_000_000_000_000));
const lowerEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// ---- Requisitions ------------------------------------------------------------------------------

export class RequisitionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 150) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() designationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() locationId?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Employee who will manage the hire (defaults to you)' }) @Transform(emptyToNull) @optionalNullable @IsUUID() hiringManagerId?: string | null;
  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES }) @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: EmploymentType;
  @ApiPropertyOptional({ minimum: 1, maximum: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) openings?: number;
  @ApiProperty({ enum: REQUISITION_REASONS }) @IsIn(REQUISITION_REASONS) reason!: RequisitionReason;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 1000) justification!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Annual CTC range' }) @Money() budgetMin?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Money() budgetMax?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) targetDate?: string | null;
  @ApiPropertyOptional({ description: 'Submit for approval right away (default: save as draft)' }) @IsOptional() @IsBoolean() submit?: boolean;
}
export class UpdateRequisitionDto extends PartialType(RequisitionDto) {}

export class RequisitionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'approve', 'all'], default: 'all', description: 'mine = raised by you; approve = waiting for your decision; all = everything you can see' })
  @IsOptional() @IsIn(['mine', 'approve', 'all']) view?: 'mine' | 'approve' | 'all';
  @ApiPropertyOptional({ enum: REQUISITION_STATUSES }) @IsOptional() @IsIn(REQUISITION_STATUSES) status?: RequisitionStatus;
}

export class ReviewRequisitionDto {
  @ApiPropertyOptional({ nullable: true, description: 'Required when rejecting' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

// ---- Jobs --------------------------------------------------------------------------------------

export class JobDto {
  @ApiProperty() @IsUUID() requisitionId!: string;
  @ApiPropertyOptional({ description: 'Defaults to the requisition title' }) @IsOptional() @Transform(trim) @IsString() @Length(2, 150) title?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(20, 20000) description!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(10000) requirements?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsInt() @Min(0) @Max(60) experienceMin?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsInt() @Min(0) @Max(60) experienceMax?: number | null;
  @ApiPropertyOptional({ description: 'List on the public careers page while open' }) @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) closesOn?: string | null;
}
export class UpdateJobDto extends PartialType(JobDto) {}

export class JobStatusDto {
  @ApiProperty({ enum: JOB_STATUSES }) @IsIn(JOB_STATUSES) status!: JobStatus;
}

export class JobQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: JOB_STATUSES }) @IsOptional() @IsIn(JOB_STATUSES) status?: JobStatus;
}

// ---- Candidates & applications -----------------------------------------------------------------

export class CandidateDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) lastName!: string;
  @ApiProperty() @Transform(lowerEmail) @IsEmail() @MaxLength(254) email!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @Matches(PHONE, { message: 'phone must be a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(150) currentCompany?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(150) currentTitle?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(60) experienceYears?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Money() currentCtc?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Money() expectedCtc?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsInt() @Min(0) @Max(365) noticePeriodDays?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(120) location?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(300) linkedinUrl?: string | null;
  @ApiPropertyOptional({ enum: CANDIDATE_SOURCES }) @IsOptional() @IsIn(CANDIDATE_SOURCES) source?: CandidateSource;
  @ApiPropertyOptional({ nullable: true, description: 'Employee who referred the candidate' }) @Transform(emptyToNull) @optionalNullable @IsUUID() referredById?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) notes?: string | null;
  @ApiPropertyOptional({ type: [String] })
  @Transform(skillList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CANDIDATE_SKILLS_MAX)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];
  @ApiPropertyOptional({ nullable: true, description: 'Also add the candidate to this job' }) @Transform(emptyToNull) @optionalNullable @IsUUID() jobId?: string | null;
}
export class UpdateCandidateDto extends PartialType(CandidateDto) {}

export class CandidateQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CANDIDATE_SOURCES }) @IsOptional() @IsIn(CANDIDATE_SOURCES) source?: CandidateSource;
}

export class DuplicateQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(lowerEmail) @IsString() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
}

export class AddApplicationDto {
  @ApiProperty() @IsUUID() candidateId!: string;
  @ApiPropertyOptional({ enum: CANDIDATE_SOURCES }) @IsOptional() @IsIn(CANDIDATE_SOURCES) source?: CandidateSource;
}

export class MoveStageDto {
  @ApiProperty({ enum: APPLICATION_STAGES }) @IsIn(APPLICATION_STAGES) stage!: ApplicationStage;
  @ApiPropertyOptional({ nullable: true, description: 'Required when rejecting' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) note?: string | null;
}

export class ApplicationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() jobId?: string;
  @ApiPropertyOptional({ enum: APPLICATION_STAGES }) @IsOptional() @IsIn(APPLICATION_STAGES) stage?: ApplicationStage;
}

// ---- Interviews --------------------------------------------------------------------------------

export class InterviewDto {
  @ApiProperty({ example: 'Technical round 1' }) @Transform(trim) @IsString() @Length(2, 120) roundName!: string;
  @ApiProperty({ example: '2026-11-20T10:30:00+05:30' }) @IsISO8601({ strict: true }) scheduledAt!: string;
  @ApiPropertyOptional({ minimum: 10, maximum: 480 }) @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(480) durationMinutes?: number;
  @ApiPropertyOptional({ enum: INTERVIEW_MODES }) @IsOptional() @IsIn(INTERVIEW_MODES) mode?: InterviewMode;
  @ApiPropertyOptional({ nullable: true, description: 'Room or meeting link' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) location?: string | null;
  @ApiProperty({ type: [String], description: 'Interviewers (employees)' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true }) panelistIds!: string[];
}
export class UpdateInterviewDto extends PartialType(InterviewDto) {}

export class FeedbackDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiProperty({ enum: FEEDBACK_RECOMMENDATIONS }) @IsIn(FEEDBACK_RECOMMENDATIONS) recommendation!: FeedbackRecommendation;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 4000) feedback!: string;
}

// ---- Offers ------------------------------------------------------------------------------------

export class OfferDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() designationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() locationId?: string | null;
  @ApiProperty({ description: 'Annual CTC' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1_000_000_000_000) annualCtc!: number;
  @ApiProperty({ example: '2026-12-01' }) @IsISO8601(DATE) joiningDate!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) expiresOn?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) notes?: string | null;
}
export class UpdateOfferDto extends PartialType(OfferDto) {}

export class OfferResponseDto {
  @ApiProperty({ enum: ['ACCEPTED', 'DECLINED'] }) @IsIn(['ACCEPTED', 'DECLINED']) response!: 'ACCEPTED' | 'DECLINED';
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) reason?: string | null;
}

export class HireDto {
  @ApiPropertyOptional({ description: 'Start onboarding with the default checklist' }) @IsOptional() @IsBoolean() startOnboarding?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Employee code (generated when empty)' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(30) employeeCode?: string | null;
}

// ---- Careers (public) --------------------------------------------------------------------------

export class PublicApplicationDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 100) lastName!: string;
  @ApiProperty() @Transform(lowerEmail) @IsEmail() @MaxLength(254) email!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @Matches(PHONE, { message: 'phone must be a valid phone number' }) phone?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(300) linkedinUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) coverNote?: string | null;
  @ApiProperty({ description: 'The candidate agrees to their data being processed for recruitment' })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  consent!: boolean;
}
