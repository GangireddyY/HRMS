import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, NotEquals } from 'class-validator';
import {
  ACCRUAL_FREQUENCIES,
  LEAVE_CODE_PATTERN,
  LEAVE_COLOR_PATTERN,
  LEAVE_GENDERS,
  LEAVE_REQUEST_STATUSES,
  LEAVE_SESSIONS,
  MANUAL_LEDGER_KINDS,
  type AccrualFrequency,
  type LeaveGender,
  type LeaveRequestStatus,
  type LeaveSession,
  type ManualLedgerKind,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const nullableInt = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class LeaveTypeDto {
  @ApiProperty({ example: 'CL' }) @Transform(upperTrim) @IsString() @Matches(LEAVE_CODE_PATTERN, { message: 'code must be 1–10 letters or digits, starting with a letter' }) code!: string;
  @ApiProperty({ example: 'Casual leave' }) @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) description?: string | null;
  @ApiPropertyOptional({ example: '#0ea5e9' }) @IsOptional() @Matches(LEAVE_COLOR_PATTERN, { message: 'color must be a hex colour like #0ea5e9' }) color?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPaid?: boolean;
  @ApiPropertyOptional({ description: 'No balance is kept (e.g. leave without pay)' }) @IsOptional() @IsBoolean() unlimited?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 366 }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(366) annualQuota?: number;
  @ApiPropertyOptional({ enum: ACCRUAL_FREQUENCIES }) @IsOptional() @IsIn(ACCRUAL_FREQUENCIES) accrualFrequency?: AccrualFrequency;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() prorateOnJoining?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 366, description: 'Days moved to the next leave year (0 = none)' }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(366) carryForwardLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() encashable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowHalfDay?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowNegativeBalance?: boolean;
  @ApiPropertyOptional({ description: 'Weekly offs and holidays within a request count as leave (sandwich rule)' }) @IsOptional() @IsBoolean() countNonWorkingDays?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 365 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) minNoticeDays?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 365 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) maxBackdatedDays?: number;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 366 }) @Transform(nullableInt) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(366) maxConsecutiveDays?: number | null;
  @ApiPropertyOptional({ minimum: 0, maximum: 3650 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) eligibleAfterDays?: number;
  @ApiPropertyOptional({ enum: LEAVE_GENDERS, nullable: true }) @Transform(emptyToNull) @optionalNullable @IsIn(LEAVE_GENDERS) applicableGender?: LeaveGender | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateLeaveTypeDto extends PartialType(LeaveTypeDto) {}

export class LeaveSettingsDto {
  @ApiProperty({ minimum: 1, maximum: 12, description: 'First month of the leave year' }) @Type(() => Number) @IsInt() @Min(1) @Max(12) leaveYearStartMonth!: number;
}

export class LeaveQuoteDto {
  @ApiProperty() @IsUUID() leaveTypeId!: string;
  @ApiProperty({ example: '2026-11-16' }) @IsISO8601(DATE) startDate!: string;
  @ApiProperty({ example: '2026-11-18' }) @IsISO8601(DATE) endDate!: string;
  @ApiPropertyOptional({ enum: LEAVE_SESSIONS, default: 'FULL' }) @IsOptional() @IsIn(LEAVE_SESSIONS) startSession?: LeaveSession;
  @ApiPropertyOptional({ enum: LEAVE_SESSIONS, default: 'FULL' }) @IsOptional() @IsIn(LEAVE_SESSIONS) endSession?: LeaveSession;
}

export class ApplyLeaveDto extends LeaveQuoteDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason!: string;
}

export class ReviewLeaveDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class RejectLeaveDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class CancelLeaveDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) reason?: string | null;
}

export class LeaveRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team', 'all'], default: 'mine', description: 'mine = own; team = requests you can approve; all = everything you can view' })
  @IsOptional() @IsIn(['mine', 'team', 'all']) view?: 'mine' | 'team' | 'all';
  @ApiPropertyOptional({ enum: LEAVE_REQUEST_STATUSES }) @IsOptional() @IsIn(LEAVE_REQUEST_STATUSES) status?: LeaveRequestStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() leaveTypeId?: string;
  @ApiPropertyOptional({ description: 'Requests overlapping this range' }) @IsOptional() @IsISO8601(DATE) from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601(DATE) to?: string;
}

export class BalanceQueryDto {
  @ApiPropertyOptional({ description: 'Default: your own' }) @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ description: 'Leave year (default: the current one)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

export class BalanceOverviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
}

export class LedgerQueryDto extends BalanceQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() leaveTypeId?: string;
}

export class AdjustmentDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsUUID() leaveTypeId!: string;
  @ApiProperty({ enum: MANUAL_LEDGER_KINDS, description: 'GRANT adds days, ENCASHMENT pays out days, ADJUSTMENT corrects either way' }) @IsIn(MANUAL_LEDGER_KINDS) kind!: ManualLedgerKind;
  @ApiProperty({ example: 2, description: 'Positive number of days for GRANT and ENCASHMENT; signed for ADJUSTMENT. Multiples of 0.5.' })
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(-366) @Max(366) @NotEquals(0)
  days!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class LeaveCalendarQueryDto {
  @ApiProperty({ example: '2026-11' }) @Matches(MONTH, { message: 'month must look like 2026-11' }) month!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
}
