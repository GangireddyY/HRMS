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
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COURSE_CATEGORIES,
  COURSE_DELIVERIES,
  COURSE_STATUSES,
  ENROLLMENT_STATUSES,
  MAX_ASSIGN_AT_ONCE,
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUESTIONS_PER_COURSE,
  type CourseCategory,
  type CourseDelivery,
  type CourseStatus,
  type EnrollmentStatus,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim, upper } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const queryBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

// ---- Courses -----------------------------------------------------------------------------------

export class CourseDto {
  @ApiProperty({ example: 'POSH-101' }) @Transform(upper) @Matches(/^[A-Z0-9][A-Z0-9_-]{1,19}$/, { message: 'code must be 2–20 letters, digits, - or _' }) code!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 150) title!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(10000) description?: string | null;
  @ApiProperty({ enum: COURSE_CATEGORIES }) @IsIn(COURSE_CATEGORIES) category!: CourseCategory;
  @ApiProperty({ enum: COURSE_DELIVERIES }) @IsIn(COURSE_DELIVERIES) delivery!: CourseDelivery;
  @ApiPropertyOptional({ nullable: true }) @optionalNullable @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0.5) @Max(1000) durationHours?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(120) provider?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(500) contentUrl?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() selfEnrollment?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() mandatory?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() hasAssessment?: boolean;
  @ApiPropertyOptional({ default: 70 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) passMark?: number;
  @ApiPropertyOptional({ default: 3 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) maxAttempts?: number;
  @ApiPropertyOptional({ nullable: true, description: 'Certificates expire this many months after completion' }) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(120) validityMonths?: number | null;
}

export class UpdateCourseDto extends PartialType(CourseDto) {}

export class CourseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: COURSE_CATEGORIES }) @IsOptional() @IsIn(COURSE_CATEGORIES) category?: CourseCategory;
  @ApiPropertyOptional({ enum: COURSE_DELIVERIES }) @IsOptional() @IsIn(COURSE_DELIVERIES) delivery?: CourseDelivery;
  @ApiPropertyOptional({ enum: COURSE_STATUSES, description: 'Managers only (the catalog shows published courses)' }) @IsOptional() @IsIn(COURSE_STATUSES) status?: CourseStatus;
  @ApiPropertyOptional({ description: 'All statuses (requires training.manage)' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() manage?: boolean;
}

export class QuestionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) prompt!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(2) @ArrayMaxSize(MAX_OPTIONS_PER_QUESTION) @IsString({ each: true }) @Length(1, 300, { each: true }) options!: string[];
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_OPTIONS_PER_QUESTION - 1) correctIndex!: number;
}

export class QuestionsDto {
  @ApiProperty({ type: [QuestionDto] }) @IsArray() @ArrayMaxSize(MAX_QUESTIONS_PER_COURSE) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions!: QuestionDto[];
}

// ---- Sessions ----------------------------------------------------------------------------------

export class SessionDto {
  @ApiProperty() @IsISO8601({ strict: true }) startsAt!: string;
  @ApiProperty() @IsISO8601({ strict: true }) endsAt!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Room or meeting link' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) location?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(120) trainer?: string | null;
  @ApiPropertyOptional({ nullable: true }) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(10000) capacity?: number | null;
}

export class UpdateSessionDto extends PartialType(SessionDto) {}

export class AttendanceEntryDto {
  @ApiProperty() @IsUUID() enrollmentId!: string;
  @ApiProperty() @IsBoolean() attended!: boolean;
}

export class AttendanceDto {
  @ApiProperty({ type: [AttendanceEntryDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => AttendanceEntryDto) entries!: AttendanceEntryDto[];
}

// ---- Enrolments --------------------------------------------------------------------------------

export class EnrollDto {
  @ApiPropertyOptional({ nullable: true, description: 'Session to join (classroom / virtual courses)' }) @Transform(emptyToNull) @optionalNullable @IsUUID() sessionId?: string | null;
}

export class AssignDto {
  @ApiProperty() @IsUUID() courseId!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(MAX_ASSIGN_AT_ONCE) @ArrayUnique() @IsUUID('4', { each: true }) employeeIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Everyone active in these departments (within your scope)' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('4', { each: true }) departmentIds?: string[];
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) dueDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() sessionId?: string | null;
}

export class EnrollmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'team']) view?: 'mine' | 'team';
  @ApiPropertyOptional() @IsOptional() @IsUUID() courseId?: string;
  @ApiPropertyOptional({ enum: ENROLLMENT_STATUSES }) @IsOptional() @IsIn(ENROLLMENT_STATUSES) status?: EnrollmentStatus;
  @ApiPropertyOptional({ description: 'Assigned, not completed, past the due date' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() overdue?: boolean;
}

export class CancelEnrollmentDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) reason?: string | null;
}

export class AttemptDto {
  @ApiProperty({ description: 'Question id → chosen option index', example: { 'question-id': 1 } }) @IsObject() answers!: Record<string, number>;
}

export class CourseFeedbackDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) comment?: string | null;
}

export class CertificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['EXPIRING', 'EXPIRED'], default: 'EXPIRING' }) @IsOptional() @IsIn(['EXPIRING', 'EXPIRED']) state?: 'EXPIRING' | 'EXPIRED';
}
