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
  DEVICE_BATCH_MAX,
  PUNCH_PHOTO_MAX_BYTES,
  SHIFT_SWAP_STATUSES,
  type ShiftSwapStatus,
  HOLIDAY_COUNTRIES,
  HOLIDAY_IMPORT_MAX,
  OVERTIME_STATUSES,
  type HolidayCountry,
  PUNCH_DIRECTIONS,
  REGULARIZATION_STATUSES,
  TIMESHEET_ACTIVITY_MAX,
  TIMESHEET_MAX_ENTRIES,
  TIMESHEET_NOTE_MAX,
  TIMESHEET_PROJECT_MAX,
  TIMESHEET_STATUSES,
  type OvertimeStatus,
  type PunchDirection,
  type RegularizationStatus,
  type TimesheetStatus,
  type TimesheetWeekStatus,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'must be a time like 09:30';

export class CreateShiftDto {
  @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiProperty({ example: '09:00' }) @Matches(TIME, { message: `startTime ${TIME_MESSAGE}` }) startTime!: string;
  @ApiProperty({ example: '18:00' }) @Matches(TIME, { message: `endTime ${TIME_MESSAGE}` }) endTime!: string;
  @ApiPropertyOptional({ default: 60 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) breakMinutes?: number;
  @ApiPropertyOptional({ default: 15 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) graceMinutes?: number;
  @ApiPropertyOptional({ default: 240 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1440) halfDayMinutes?: number;
  @ApiPropertyOptional({ default: 480 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) fullDayMinutes?: number;

  @ApiPropertyOptional({ type: [Number], example: [0, 6], description: '0 = Sunday … 6 = Saturday' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyOffs?: number[];

  @ApiPropertyOptional({ default: false, description: 'Count overtime on this shift' }) @IsOptional() @IsBoolean() overtimeEnabled?: boolean;
  @ApiPropertyOptional({ default: 540, description: 'Worked minutes after which overtime starts on working days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  overtimeAfterMinutes?: number;
  @ApiPropertyOptional({ default: 30, description: 'Shorter overtime is not counted' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(480) overtimeMinMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

export class HolidayQueryDto {
  @ApiPropertyOptional({ example: 2026 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

export class CreateHolidayDto {
  @ApiProperty({ example: '2026-08-15' }) @IsISO8601(DATE) date!: string;
  @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isOptional?: boolean;
  @ApiPropertyOptional({ type: [String], description: 'Locations that observe it; empty or missing = every location' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  locationIds?: string[];
}
export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}

const HOLIDAY_COUNTRY_CODES = Object.keys(HOLIDAY_COUNTRIES) as HolidayCountry[];

export class OfficialHolidaysQueryDto {
  @ApiProperty({ example: 2027 }) @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiPropertyOptional({ enum: HOLIDAY_COUNTRY_CODES, description: "Defaults to the organization's country" })
  @IsOptional()
  @IsIn(HOLIDAY_COUNTRY_CODES)
  country?: HolidayCountry;
}

export class ImportHolidaysDto {
  @ApiPropertyOptional({ enum: HOLIDAY_COUNTRY_CODES, description: 'Where the holidays came from (for the audit log)' })
  @IsOptional()
  @IsIn(HOLIDAY_COUNTRY_CODES)
  country?: HolidayCountry;
  @ApiPropertyOptional({ type: [String], description: 'Locations the imported holidays apply to (default: every location); a holiday can also set its own' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  locationIds?: string[];
  @ApiProperty({ type: [CreateHolidayDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(HOLIDAY_IMPORT_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreateHolidayDto)
  holidays!: CreateHolidayDto[];
}

export class PunchDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional({ description: 'Camera photo as a data URL (data:image/jpeg;base64,…), when the location asks for one' })
  @IsOptional()
  @IsString()
  @MaxLength(Math.ceil((PUNCH_PHOTO_MAX_BYTES * 4) / 3) + 64)
  photo?: string;
}

export class ShiftSwapDto {
  @ApiProperty({ description: 'The colleague who works your shift (you work theirs)' }) @IsUUID() colleagueId!: string;
  @ApiProperty({ example: '2026-11-20' }) @IsISO8601({ strict: true, strictSeparator: true }) workDate!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason!: string;
}

export class ShiftSwapResponseDto {
  @ApiProperty() @IsBoolean() accept!: boolean;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class ShiftSwapQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine', description: 'team = swaps you can approve' }) @IsOptional() @IsIn(['mine', 'team']) view?: 'mine' | 'team';
  @ApiPropertyOptional({ enum: SHIFT_SWAP_STATUSES }) @IsOptional() @IsIn(SHIFT_SWAP_STATUSES) status?: ShiftSwapStatus;
}

export class CalendarQueryDto {
  @ApiProperty({ example: '2026-11' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month!: string;
  @ApiPropertyOptional({ description: 'Defaults to the caller' }) @IsOptional() @IsUUID() employeeId?: string;
}

export class DailyQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-11-05', description: 'Defaults to today (organization time zone)' })
  @IsOptional()
  @IsISO8601(DATE)
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;

  @ApiPropertyOptional({ enum: ['PRESENT', 'HALF_DAY', 'ABSENT', 'IN_PROGRESS', 'MISSED_PUNCH', 'ON_LEAVE', 'LATE', 'REMOTE'] })
  @IsOptional()
  @IsIn(['PRESENT', 'HALF_DAY', 'ABSENT', 'IN_PROGRESS', 'MISSED_PUNCH', 'ON_LEAVE', 'LATE', 'REMOTE'])
  status?: string;
}

/** Manual correction by HR (attendance.manage). */
export class UpsertRecordDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty({ example: '2026-11-04' }) @IsISO8601(DATE) workDate!: string;
  @ApiProperty({ example: '09:05' }) @Matches(TIME, { message: `checkIn ${TIME_MESSAGE}` }) checkIn!: string;
  @ApiPropertyOptional({ example: '18:10', nullable: true }) @Transform(emptyToNull) @optionalNullable @Matches(TIME, { message: `checkOut ${TIME_MESSAGE}` }) checkOut?: string | null;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class CreateRegularizationDto {
  @ApiProperty({ example: '2026-11-04' }) @IsISO8601(DATE) workDate!: string;
  @ApiProperty({ example: '09:05' }) @Matches(TIME, { message: `checkIn ${TIME_MESSAGE}` }) checkIn!: string;
  @ApiProperty({ example: '18:10', description: 'Earlier than check-in means the next day (night shift)' }) @Matches(TIME, { message: `checkOut ${TIME_MESSAGE}` }) checkOut!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 500) reason!: string;
}

export class RegularizationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'team']) view?: 'mine' | 'team';
  @ApiPropertyOptional({ enum: REGULARIZATION_STATUSES }) @IsOptional() @IsIn(REGULARIZATION_STATUSES) status?: RegularizationStatus;
}

export class ReviewDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

// ---- Timesheets ---------------------------------------------------------------------------------

export class TimesheetEntryDto {
  @ApiProperty({ description: '0 = Monday … 6 = Sunday', example: 0 }) @Type(() => Number) @IsInt() @Min(0) @Max(6) day!: number;
  @ApiProperty({ example: 'Payroll migration' }) @Transform(trim) @IsString() @Length(1, TIMESHEET_PROJECT_MAX) project!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Development' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(TIMESHEET_ACTIVITY_MAX) activity?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '09:00' }) @Transform(emptyToNull) @optionalNullable @Matches(TIME, { message: `start ${TIME_MESSAGE}` }) start?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '18:00' }) @Transform(emptyToNull) @optionalNullable @Matches(TIME, { message: `end ${TIME_MESSAGE}` }) end?: string | null;
  @ApiPropertyOptional({ description: 'Minutes, when no From–To is given', example: 480 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1440) minutes?: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(TIMESHEET_NOTE_MAX) note?: string | null;
}
export class SaveTimesheetDto {
  @ApiProperty({ example: '2026-11-09', description: 'Monday of the week' }) @IsISO8601(DATE) weekStart!: string;
  @ApiProperty({ type: [TimesheetEntryDto] }) @IsArray() @ArrayMaxSize(TIMESHEET_MAX_ENTRIES) @ValidateNested({ each: true }) @Type(() => TimesheetEntryDto) entries!: TimesheetEntryDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Note for the reviewer' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}
export class TimesheetWeekQueryDto {
  @ApiPropertyOptional({ example: '2026-11-09', description: 'Any day of the week (defaults to this week)' }) @IsOptional() @IsISO8601(DATE) weekStart?: string;
}
export class TimesheetQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'team']) view?: 'mine' | 'team';
  @ApiPropertyOptional({ enum: TIMESHEET_STATUSES }) @IsOptional() @IsIn(TIMESHEET_STATUSES) status?: TimesheetStatus;
  @ApiPropertyOptional({ example: '2026-11-09' }) @IsOptional() @IsISO8601(DATE) weekStart?: string;
}
export class TimesheetBoardQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-11-09' }) @IsOptional() @IsISO8601(DATE) weekStart?: string;
  @ApiPropertyOptional({ enum: [...TIMESHEET_STATUSES, 'MISSING'] }) @IsOptional() @IsIn([...TIMESHEET_STATUSES, 'MISSING']) status?: TimesheetWeekStatus;
}
export class TimesheetRemindDto {
  @ApiProperty({ example: '2026-11-02' }) @IsISO8601(DATE) weekStart!: string;
}

export class PeriodQueryDto {
  @ApiPropertyOptional({ example: 2026 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

// ---- Overtime ------------------------------------------------------------------------------------

export class OvertimeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'team']) view?: 'mine' | 'team';
  @ApiPropertyOptional({ enum: OVERTIME_STATUSES }) @IsOptional() @IsIn(OVERTIME_STATUSES) status?: OvertimeStatus;
  @ApiPropertyOptional({ example: '2026-11' }) @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month?: string;
}

export class ReviewOvertimeDto {
  @ApiPropertyOptional({ description: 'Approve fewer minutes than worked' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) minutes?: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

// ---- Work from home ------------------------------------------------------------------------------

export class CreateWorkFromHomeDto {
  @ApiProperty({ example: '2026-11-10' }) @IsISO8601(DATE) startDate!: string;
  @ApiProperty({ example: '2026-11-11' }) @IsISO8601(DATE) endDate!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 500) reason!: string;
}

export class WorkFromHomeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'team']) view?: 'mine' | 'team';
  @ApiPropertyOptional({ enum: REGULARIZATION_STATUSES }) @IsOptional() @IsIn(REGULARIZATION_STATUSES) status?: RegularizationStatus;
}

// ---- Rosters & rotations -------------------------------------------------------------------------

export class RotationStepDto {
  @ApiPropertyOptional({ nullable: true, description: 'null = day off' }) @optionalNullable @IsUUID() shiftId?: string | null;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(28) days!: number;
}

export class RotationDto {
  @ApiProperty({ example: 'Two-shift rotation' }) @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiProperty({ type: [RotationStepDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RotationStepDto) pattern!: RotationStepDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateRotationDto extends PartialType(RotationDto) {}

export class RosterQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: '2026-11-09' }) @IsISO8601(DATE) from!: string;
  @ApiProperty({ example: '2026-11-15' }) @IsISO8601(DATE) to!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
}

export class ClearRosterDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID('all', { each: true }) employeeIds!: string[];
  @ApiProperty() @IsISO8601(DATE) from!: string;
  @ApiProperty() @IsISO8601(DATE) to!: string;
}

export class AssignRosterDto extends ClearRosterDto {
  @ApiPropertyOptional({ nullable: true, description: 'null = day off' }) @optionalNullable @IsUUID() shiftId?: string | null;
}

export class ApplyRotationDto extends ClearRosterDto {
  @ApiProperty() @IsUUID() rotationId!: string;
  @ApiPropertyOptional({ default: 0, description: 'Days into the cycle on the first day (to stagger teams)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(55) offset?: number;
}

// ---- Devices -------------------------------------------------------------------------------------

export class DeviceDto {
  @ApiProperty({ example: 'Main entrance' }) @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional({ nullable: true }) @optionalNullable @IsUUID() locationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(60) serialNumber?: string | null;
}

export class UpdateDeviceDto extends PartialType(DeviceDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class DevicePunchDto {
  @ApiProperty({ example: '1042', description: "The employee's user number on the device (or their employee code)" }) @Transform(trim) @IsString() @Length(1, 30) userCode!: string;
  @ApiProperty({ example: '2026-11-06T09:02:11+05:30', description: 'ISO 8601 with the time zone offset' }) @IsISO8601({ strict: true }) timestamp!: string;
  @ApiPropertyOptional({ enum: PUNCH_DIRECTIONS, default: 'AUTO' }) @IsOptional() @IsIn(PUNCH_DIRECTIONS) direction?: PunchDirection;
}

export class DevicePunchesDto {
  @ApiProperty({ type: [DevicePunchDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(DEVICE_BATCH_MAX) @ValidateNested({ each: true }) @Type(() => DevicePunchDto) punches!: DevicePunchDto[];
}

export class BiometricCodeDto {
  @ApiPropertyOptional({ nullable: true, example: '1042' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,30}$/, { message: 'Use up to 30 letters, digits, - or _' })
  biometricCode?: string | null;
}
