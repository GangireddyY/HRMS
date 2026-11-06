import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
} from 'class-validator';
import { REGULARIZATION_STATUSES, type RegularizationStatus } from '../../../contracts';
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
  @IsOptional() @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  weeklyOffs?: number[];

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
}
export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}

export class PunchDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
}

export class CalendarQueryDto {
  @ApiProperty({ example: '2026-11' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month!: string;
  @ApiPropertyOptional({ description: 'Defaults to the caller' }) @IsOptional() @IsUUID() employeeId?: string;
}

export class DailyQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-11-05', description: 'Defaults to today (organization time zone)' })
  @IsOptional() @IsISO8601(DATE)
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;

  @ApiPropertyOptional({ enum: ['PRESENT', 'HALF_DAY', 'ABSENT', 'IN_PROGRESS', 'MISSED_PUNCH', 'LATE'] })
  @IsOptional() @IsIn(['PRESENT', 'HALF_DAY', 'ABSENT', 'IN_PROGRESS', 'MISSED_PUNCH', 'LATE'])
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

export class PeriodQueryDto {
  @ApiPropertyOptional({ example: 2026 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}
