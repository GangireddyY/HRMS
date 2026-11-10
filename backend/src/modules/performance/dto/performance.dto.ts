import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CYCLE_STATUSES,
  HIKE_STATUSES,
  MAX_HIKE_PERCENT,
  type HikeStatus,
  MAX_FEEDBACK_REQUESTS_PER_REVIEW,
  OKR_HEALTH,
  OKR_LEVELS,
  OKR_MAX_KEY_RESULTS,
  OKR_METRICS,
  OKR_STATUSES,
  ONE_ON_ONE_ITEM_KINDS,
  ONE_ON_ONE_STATUSES,
  type OkrHealth,
  type OkrLevel,
  type OkrMetric,
  type OkrStatus,
  type OneOnOneItemKind,
  type OneOnOneStatus,
  PIP_PROGRESS,
  PIP_STATUSES,
  RATING_MAX,
  RATING_MIN,
  REVIEW_STAGES,
  type CycleStatus,
  type PipProgress,
  type PipStatus,
  type ReviewStage,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
/** Optional, nullable rating on the 1?5 scale. */
const Rating = () => applyDecorators(optionalNullable, Type(() => Number), IsInt(), Min(RATING_MIN), Max(RATING_MAX));

// ---- Cycles ------------------------------------------------------------------------------------

export class CompetencyDto {
  @ApiProperty({ example: 'communication' }) @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, { message: 'key must be lowercase letters, digits or dashes' }) key!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) description?: string | null;
}

export class CycleDto {
  @ApiProperty({ example: 'Annual review 2026' }) @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) description?: string | null;
  @ApiProperty({ example: '2026-04-01' }) @IsISO8601(DATE) periodStart!: string;
  @ApiProperty({ example: '2027-03-31' }) @IsISO8601(DATE) periodEnd!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) goalsDue?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) selfReviewDue?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) managerReviewDue?: string | null;
  @ApiPropertyOptional({ default: 70, description: 'Share of the overall score from goals (%)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) goalsWeight?: number;
  @ApiPropertyOptional({ type: [CompetencyDto] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => CompetencyDto) competencies?: CompetencyDto[];
  @ApiPropertyOptional({ type: [String], description: 'Labels for ratings 1?5' })
  @IsOptional() @IsArray() @ArrayMinSize(5) @ArrayMaxSize(5) @IsString({ each: true }) @Length(2, 60, { each: true }) ratingLabels?: string[];
  @ApiPropertyOptional({ nullable: true, description: 'Only employees who joined on or before this date take part' }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) eligibilityCutoff?: string | null;
  @ApiPropertyOptional({ nullable: true, type: [String], description: 'Limit to these departments (null = all)' })
  @optionalNullable @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsUUID('4', { each: true }) departmentIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true, type: [Number], example: [5, 15, 50, 20, 10], description: 'Calibration target: % of people expected at ratings 1 to 5 (adds up to 100)' })
  @optionalNullable @IsArray() @ArrayMinSize(5) @ArrayMaxSize(5) @Type(() => Number) @IsInt({ each: true }) @Min(0, { each: true }) @Max(100, { each: true }) targetDistribution?: number[] | null;
}

export class UpdateCycleDto extends PartialType(CycleDto) {}

export class CycleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CYCLE_STATUSES }) @IsOptional() @IsIn(CYCLE_STATUSES) status?: CycleStatus;
}

// ---- Reviews -----------------------------------------------------------------------------------

export class ReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cycleId?: string;
  @ApiPropertyOptional({ enum: ['mine', 'team', 'all'], default: 'team' }) @IsOptional() @IsIn(['mine', 'team', 'all']) view?: 'mine' | 'team' | 'all';
  @ApiPropertyOptional({ enum: REVIEW_STAGES }) @IsOptional() @IsIn(REVIEW_STAGES) stage?: ReviewStage;
}

export class ReassignReviewerDto {
  @ApiProperty() @IsUUID() reviewerId!: string;
}

export class AddParticipantsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('4', { each: true }) employeeIds!: string[];
}

export class GoalDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'How success is measured' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) measure?: string | null;
  @ApiProperty({ description: 'Weight in % (all goals add up to 100)' }) @Type(() => Number) @IsInt() @Min(1) @Max(100) weight!: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) dueDate?: string | null;
}

export class UpdateGoalDto extends PartialType(GoalDto) {}

export class GoalProgressDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(100) progress!: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) progressNote?: string | null;
}

export class ReturnGoalsDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) note!: string;
}

export class GoalRatingDto {
  @ApiProperty() @IsUUID() goalId!: string;
  @ApiPropertyOptional({ nullable: true }) @Rating() rating?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) comment?: string | null;
}

export class CompetencyRatingDto {
  @ApiProperty() @IsString() @MaxLength(40) key!: string;
  @ApiPropertyOptional({ nullable: true }) @Rating() rating?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) comment?: string | null;
}

export class AssessmentDto {
  @ApiProperty({ type: [GoalRatingDto] }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => GoalRatingDto) goals!: GoalRatingDto[];
  @ApiPropertyOptional({ type: [CompetencyRatingDto] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => CompetencyRatingDto) competencies?: CompetencyRatingDto[];
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(5000) comment?: string | null;
  @ApiPropertyOptional({ description: 'Submit (final) rather than save a draft' }) @IsOptional() @IsBoolean() submit?: boolean;
}

export class ManagerAssessmentDto extends AssessmentDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(5000) strengths?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(5000) improvements?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Final rating 1?5 (defaults to the suggested rating)' }) @Rating() finalRating?: number | null;
}

export class CalibrateDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(RATING_MIN) @Max(RATING_MAX) rating!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) note!: string;
}

export class PotentialDto {
  @ApiProperty({ minimum: 1, maximum: 3, nullable: true, description: '1 low, 2 medium, 3 high (null clears it)' }) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(3) potential!: number | null;
}

export class AcknowledgeDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) comment?: string | null;
}

// ---- Feedback ----------------------------------------------------------------------------------

export class FeedbackRequestDto {
  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_FEEDBACK_REQUESTS_PER_REVIEW) @ArrayUnique() @IsUUID('4', { each: true }) employeeIds!: string[];
}

export class GiveFeedbackDto {
  @ApiPropertyOptional({ nullable: true }) @Rating() rating?: number | null;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 2000) strengths!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 2000) improvements!: string;
}

// ---- PIPs --------------------------------------------------------------------------------------

export class PipObjectiveDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) measure?: string | null;
}

export class PipDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() reviewId?: string | null;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 2000) reason!: string;
  @ApiProperty({ type: [PipObjectiveDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PipObjectiveDto) objectives!: PipObjectiveDto[];
  @ApiProperty() @IsISO8601(DATE) startDate!: string;
  @ApiProperty() @IsISO8601(DATE) endDate!: string;
}

export class UpdatePipDto {
  @ApiPropertyOptional({ type: [PipObjectiveDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PipObjectiveDto) objectives?: PipObjectiveDto[];
  @ApiPropertyOptional({ description: 'Extend the plan' }) @IsOptional() @IsISO8601(DATE) endDate?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(10, 2000) reason?: string;
}

export class PipQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'managed'], default: 'managed' }) @IsOptional() @IsIn(['mine', 'managed']) view?: 'mine' | 'managed';
  @ApiPropertyOptional({ enum: PIP_STATUSES }) @IsOptional() @IsIn(PIP_STATUSES) status?: PipStatus;
}

export class CheckInDto {
  @ApiProperty() @IsISO8601(DATE) checkInDate!: string;
  @ApiProperty({ enum: PIP_PROGRESS }) @IsIn(PIP_PROGRESS) progress!: PipProgress;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 2000) note!: string;
}

export class ClosePipDto {
  @ApiProperty({ enum: ['SUCCESSFUL', 'UNSUCCESSFUL', 'CANCELLED'] }) @IsIn(['SUCCESSFUL', 'UNSUCCESSFUL', 'CANCELLED']) outcome!: 'SUCCESSFUL' | 'UNSUCCESSFUL' | 'CANCELLED';
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 2000) note!: string;
  @ApiPropertyOptional({ type: [Boolean], description: 'Whether each objective was met (same order)' }) @IsOptional() @IsArray() @IsBoolean({ each: true }) objectivesMet?: boolean[];
}

// ---- OKRs --------------------------------------------------------------------------------------

export class KeyResultDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiProperty({ enum: OKR_METRICS }) @IsIn(OKR_METRICS) metric!: OkrMetric;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-1e11) @Max(1e11) startValue?: number;
  @ApiPropertyOptional({ description: 'Required unless the metric is MILESTONE (done = 1)' }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-1e11) @Max(1e11) targetValue?: number;
  @ApiPropertyOptional({ nullable: true, example: 'deals' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(20) unit?: string | null;
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) weight?: number;
}

export class UpdateKeyResultDto extends PartialType(KeyResultDto) {}

export class ObjectiveDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) description?: string | null;
  @ApiProperty({ enum: OKR_LEVELS }) @IsIn(OKR_LEVELS) level!: OkrLevel;
  @ApiPropertyOptional({ nullable: true, description: 'Individual objectives: whose (defaults to you)' }) @Transform(emptyToNull) @optionalNullable @IsUUID() ownerEmployeeId?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Department objectives: which department' }) @Transform(emptyToNull) @optionalNullable @IsUUID() departmentId?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'The objective this one supports' }) @Transform(emptyToNull) @optionalNullable @IsUUID() parentId?: string | null;
  @ApiProperty({ example: '2026-10-01' }) @IsISO8601(DATE) periodStart!: string;
  @ApiProperty({ example: '2026-12-31' }) @IsISO8601(DATE) periodEnd!: string;
  @ApiPropertyOptional({ type: [KeyResultDto] }) @IsOptional() @IsArray() @ArrayMaxSize(OKR_MAX_KEY_RESULTS) @ValidateNested({ each: true }) @Type(() => KeyResultDto) keyResults?: KeyResultDto[];
}

export class UpdateObjectiveDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 200) title?: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601(DATE) periodStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601(DATE) periodEnd?: string;
  @ApiPropertyOptional({ enum: OKR_STATUSES }) @IsOptional() @IsIn(OKR_STATUSES) status?: OkrStatus;
}

export class OkrQueryDto {
  @ApiPropertyOptional({ description: 'Objectives whose period covers this date (default today)' }) @IsOptional() @IsISO8601(DATE) date?: string;
  @ApiPropertyOptional({ enum: OKR_LEVELS }) @IsOptional() @IsIn(OKR_LEVELS) level?: OkrLevel;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ enum: OKR_STATUSES }) @IsOptional() @IsIn(OKR_STATUSES) status?: OkrStatus;
}

export class OkrCheckInDto {
  @ApiProperty({ description: 'The current value (MILESTONE: 1 done, 0 not yet)' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-1e11) @Max(1e11) value!: number;
  @ApiProperty({ enum: OKR_HEALTH }) @IsIn(OKR_HEALTH) health!: OkrHealth;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) note?: string | null;
}

// ---- 1:1s --------------------------------------------------------------------------------------

export class OneOnOneDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty({ example: '2026-11-12T10:00:00+05:30' }) @IsISO8601({ strict: true }) scheduledAt!: string;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(480) durationMinutes?: number;
  @ApiPropertyOptional({ type: [String], description: 'Agenda topics to start with' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value)) @IsString({ each: true }) @Length(2, 500, { each: true }) topics?: string[];
}

export class UpdateOneOnOneDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) scheduledAt?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(480) durationMinutes?: number;
  @ApiPropertyOptional({ nullable: true, description: 'Seen by both' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(20000) sharedNotes?: string | null;
  @ApiPropertyOptional({ nullable: true, description: "The manager's private notes" }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(20000) managerNotes?: string | null;
}

export class OneOnOneItemDto {
  @ApiProperty({ enum: ONE_ON_ONE_ITEM_KINDS }) @IsIn(ONE_ON_ONE_ITEM_KINDS) kind!: OneOnOneItemKind;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 500) text!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Actions: who does it (the manager or the employee)' }) @Transform(emptyToNull) @optionalNullable @IsUUID() ownerEmployeeId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) dueDate?: string | null;
}

export class UpdateOneOnOneItemDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() done?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 500) text?: string;
}

export class CompleteOneOnOneDto {
  @ApiPropertyOptional({ nullable: true, description: 'Schedule the next 1:1; open topics and actions carry over' }) @Transform(emptyToNull) @optionalNullable @IsISO8601({ strict: true }) nextAt?: string | null;
}

export class OneOnOneQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine', description: 'mine = your own 1:1s with your manager; team = the ones you hold' }) @IsOptional() @IsIn(['mine', 'team']) view?: 'mine' | 'team';
  @ApiPropertyOptional({ enum: ONE_ON_ONE_STATUSES }) @IsOptional() @IsIn(ONE_ON_ONE_STATUSES) status?: OneOnOneStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
}

// ---- Salary-hike recommendations -----------------------------------------------------------------

export class MeritGuidelineDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_HIKE_PERCENT) min!: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_HIKE_PERCENT) target!: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_HIKE_PERCENT) max!: number;
}

export class CompensationDto {
  @ApiProperty({ type: [MeritGuidelineDto], description: 'One row per rating 1?5, in % of the annual CTC' }) @IsArray() @ArrayMinSize(5) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => MeritGuidelineDto) meritMatrix!: MeritGuidelineDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Increase budget as % of the current CTC of everyone reviewed' })
  @Transform(({ value }) => (value === '' ? null : value)) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) budgetPercent?: number | null;
  @ApiPropertyOptional({ nullable: true, example: '2027-04-01', description: 'When approved increments take effect' }) @Transform(({ value }) => (value === '' ? null : value)) @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) effectiveFrom?: string | null;
}

export class HikeQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'all'], description: "mine = the caller's reviewees; all = HR" }) @IsOptional() @IsIn(['mine', 'all']) view?: 'mine' | 'all';
  @ApiPropertyOptional({ enum: HIKE_STATUSES }) @IsOptional() @IsIn(HIKE_STATUSES) status?: HikeStatus;
}

export class HikeDto {
  @ApiProperty({ description: 'Increase in % of the annual CTC' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_HIKE_PERCENT) percent!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() promotion?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Required outside the guideline' }) @Transform(({ value }) => (typeof value === 'string' && !value.trim() ? null : value)) @IsOptional() @IsString() @MaxLength(1000) justification?: string | null;
}

export class DecideHikeDto {
  @ApiPropertyOptional({ description: 'Approve a different percentage' }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_HIKE_PERCENT) percent?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}