import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  DOCUMENT_CATEGORIES,
  ONBOARDING_ASSIGNEES,
  ONBOARDING_CASE_STATUSES,
  PROBATION_RECOMMENDATIONS,
  PROBATION_REVIEW_STATUSES,
  type DocumentCategory,
  type OnboardingAssignee,
  type OnboardingCaseStatus,
  type ProbationRecommendation,
  type ProbationReviewStatus,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };

export class TemplateTaskDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 200) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) description?: string | null;
  @ApiProperty({ enum: ONBOARDING_ASSIGNEES }) @IsIn(ONBOARDING_ASSIGNEES) assignee!: OnboardingAssignee;
  @ApiPropertyOptional({ enum: DOCUMENT_CATEGORIES, nullable: true, description: 'Makes it an "upload this document" task (assignee must be EMPLOYEE)' })
  @Transform(emptyToNull) @optionalNullable @IsIn(DOCUMENT_CATEGORIES)
  documentCategory?: DocumentCategory | null;
  @ApiPropertyOptional({ minimum: -180, maximum: 365, description: 'Days from the date of joining (negative = before)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(-180) @Max(365) dueOffsetDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
}

export class TemplateDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [TemplateTaskDto], description: 'Tasks in order; replaces the existing list' })
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TemplateTaskDto)
  tasks!: TemplateTaskDto[];
}
export class UpdateTemplateDto extends PartialType(TemplateDto) {}

export class StartCaseDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Checklist template (default: the default template; none = empty checklist)' }) @Transform(emptyToNull) @optionalNullable @IsUUID() templateId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() buddyId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) notes?: string | null;
}

export class UpdateCaseDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() buddyId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) notes?: string | null;
}

export class CaseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ONBOARDING_CASE_STATUSES }) @IsOptional() @IsIn(ONBOARDING_CASE_STATUSES) status?: OnboardingCaseStatus;
}

export class CaseTaskDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 200) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) description?: string | null;
  @ApiProperty({ enum: ONBOARDING_ASSIGNEES }) @IsIn(ONBOARDING_ASSIGNEES) assignee!: OnboardingAssignee;
  @ApiPropertyOptional({ enum: DOCUMENT_CATEGORIES, nullable: true }) @Transform(emptyToNull) @optionalNullable @IsIn(DOCUMENT_CATEGORIES) documentCategory?: DocumentCategory | null;
  @ApiProperty({ example: '2026-11-20' }) @IsISO8601(DATE) dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
}
export class UpdateCaseTaskDto extends PartialType(CaseTaskDto) {}

export class TaskActionDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class VerifyTaskDocumentDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] }) @IsIn(['VERIFIED', 'REJECTED']) status!: 'VERIFIED' | 'REJECTED';
  @ApiPropertyOptional({ nullable: true, description: 'Required when rejecting' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class CancelCaseDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason!: string;
}

export class ProbationQueryDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 365, default: 60, description: 'Probations ending within this many days (overdue ones are always included)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365)
  days?: number;
}

export class ProbationReviewDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty({ enum: PROBATION_RECOMMENDATIONS }) @IsIn(PROBATION_RECOMMENDATIONS) recommendation!: ProbationRecommendation;
  @ApiPropertyOptional({ nullable: true, description: 'New probation end date (EXTEND only)' }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) extendTo?: string | null;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 1000) comments!: string;
}

export class ProbationReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['approve', 'mine'], default: 'approve', description: 'approve = reviews you can decide; mine = reviews you submitted' })
  @IsOptional() @IsIn(['approve', 'mine']) view?: 'approve' | 'mine';
  @ApiPropertyOptional({ enum: PROBATION_REVIEW_STATUSES }) @IsOptional() @IsIn(PROBATION_REVIEW_STATUSES) status?: ProbationReviewStatus;
}

export class DecideReviewDto {
  @ApiPropertyOptional({ nullable: true, description: 'Required when rejecting' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}
