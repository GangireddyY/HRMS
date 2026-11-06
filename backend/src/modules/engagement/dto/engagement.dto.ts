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
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_STATUSES,
  MAX_RECOGNITION_RECIPIENTS,
  MAX_SURVEY_QUESTIONS,
  RECOGNITION_BADGES,
  RSVP_RESPONSES,
  SUGGESTION_CATEGORIES,
  SUGGESTION_STATUSES,
  SURVEY_QUESTION_TYPES,
  SURVEY_STATUSES,
  type AnnouncementCategory,
  type AnnouncementStatus,
  type RecognitionBadge,
  type RsvpResponse,
  type SuggestionCategory,
  type SuggestionStatus,
  type SurveyQuestionType,
  type SurveyStatus,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const queryBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);
/** Optional, nullable list of ids (audience filters). */
const Ids = (max: number) => applyDecorators(optionalNullable, IsArray(), ArrayMaxSize(max), ArrayUnique(), IsUUID('4', { each: true }));

// ---- Announcements -----------------------------------------------------------------------------

export class AnnouncementDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 20000) body!: string;
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_CATEGORIES }) @IsOptional() @IsIn(ANNOUNCEMENT_CATEGORIES) category?: AnnouncementCategory;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional({ description: 'Employees must acknowledge they have read it' }) @IsOptional() @IsBoolean() requiresAck?: boolean;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(200) departmentIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(200) locationIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601({ strict: true }) eventStartsAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601({ strict: true }) eventEndsAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) eventLocation?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Hidden from the feed after this time' }) @Transform(emptyToNull) @optionalNullable @IsISO8601({ strict: true }) expiresAt?: string | null;
}

export class UpdateAnnouncementDto extends PartialType(AnnouncementDto) {}

export class AnnouncementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'All announcements incl. drafts (requires engagement.announcement.manage)' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() manage?: boolean;
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_STATUSES }) @IsOptional() @IsIn(ANNOUNCEMENT_STATUSES) status?: AnnouncementStatus;
  @ApiPropertyOptional({ enum: ANNOUNCEMENT_CATEGORIES }) @IsOptional() @IsIn(ANNOUNCEMENT_CATEGORIES) category?: AnnouncementCategory;
}

export class RsvpDto {
  @ApiProperty({ enum: RSVP_RESPONSES }) @IsIn(RSVP_RESPONSES) response!: RsvpResponse;
}

// ---- Surveys -----------------------------------------------------------------------------------

export class SurveyQuestionDto {
  @ApiProperty({ enum: SURVEY_QUESTION_TYPES }) @IsIn(SURVEY_QUESTION_TYPES) type!: SurveyQuestionType;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) prompt!: string;
  @ApiPropertyOptional({ type: [String], description: 'CHOICE only: 2–10 options' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 200, { each: true }) options?: string[];
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() required?: boolean;
}

export class SurveyDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() anonymous?: boolean;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(200) departmentIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601({ strict: true }) closesAt?: string | null;
  @ApiProperty({ type: [SurveyQuestionDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_SURVEY_QUESTIONS) @ValidateNested({ each: true }) @Type(() => SurveyQuestionDto) questions!: SurveyQuestionDto[];
}

export class UpdateSurveyDto extends PartialType(SurveyDto) {}

export class SurveyQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'All surveys incl. drafts (requires engagement.survey.manage)' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() manage?: boolean;
  @ApiPropertyOptional({ enum: SURVEY_STATUSES }) @IsOptional() @IsIn(SURVEY_STATUSES) status?: SurveyStatus;
}

export class SurveyAnswersDto {
  @ApiProperty({ description: 'Question id → answer (number for RATING / NPS / CHOICE index, text for TEXT)' }) @IsObject() answers!: Record<string, unknown>;
}

// ---- Recognition & suggestions -----------------------------------------------------------------

export class RecognitionDto {
  @ApiProperty({ type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_RECOGNITION_RECIPIENTS) @ArrayUnique() @IsUUID('4', { each: true }) recipientIds!: string[];
  @ApiProperty({ enum: RECOGNITION_BADGES }) @IsIn(RECOGNITION_BADGES) badge!: RecognitionBadge;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 1000) message!: string;
}

export class RecognitionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only recognitions received by this employee' }) @IsOptional() @IsUUID() employeeId?: string;
}

export class SuggestionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 4000) body!: string;
  @ApiProperty({ enum: SUGGESTION_CATEGORIES }) @IsIn(SUGGESTION_CATEGORIES) category!: SuggestionCategory;
  @ApiPropertyOptional({ description: 'Submit without your name (you will not see replies)' }) @IsOptional() @IsBoolean() anonymous?: boolean;
}

export class SuggestionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'all'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'all']) view?: 'mine' | 'all';
  @ApiPropertyOptional({ enum: SUGGESTION_STATUSES }) @IsOptional() @IsIn(SUGGESTION_STATUSES) status?: SuggestionStatus;
}

export class ReviewSuggestionDto {
  @ApiProperty({ enum: SUGGESTION_STATUSES }) @IsIn(SUGGESTION_STATUSES) status!: SuggestionStatus;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) response?: string | null;
}
