import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  CLEARANCE_DEPARTMENTS,
  CLEARANCE_STATUSES,
  DAILY_RATE_BASES,
  EXIT_REASONS,
  EXIT_STATUSES,
  EXIT_TYPES,
  type ClearanceDepartment,
  type ClearanceStatus,
  type DailyRateBasis,
  type ExitReason,
  type ExitStatus,
  type ExitType,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const Text = (max: number) => applyDecorators(Transform(emptyToNull), optionalNullable, IsString(), MaxLength(max));

export class ResignDto {
  @ApiProperty({ enum: EXIT_REASONS }) @IsIn(EXIT_REASONS) reason!: ExitReason;
  @ApiPropertyOptional({ nullable: true }) @Text(2000) reasonDetail?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'The last working day you would like (HR decides)' }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) requestedLastDay?: string | null;
}

export class InitiateExitDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty({ enum: EXIT_TYPES }) @IsIn(EXIT_TYPES) type!: ExitType;
  @ApiProperty({ enum: EXIT_REASONS }) @IsIn(EXIT_REASONS) reason!: ExitReason;
  @ApiPropertyOptional({ nullable: true }) @Text(2000) reasonDetail?: string | null;
  @ApiProperty({ description: 'When notice was given (or the separation date)' }) @IsISO8601(DATE) noticeGivenOn!: string;
  @ApiProperty() @IsISO8601(DATE) lastWorkingDay!: string;
  @ApiPropertyOptional({ description: "Defaults to the employee's notice period" }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) noticeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() waiveNotice?: boolean;
}

export class ExitQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'approve'], default: 'all', description: 'approve = resignations waiting for me' }) @IsOptional() @IsIn(['all', 'approve']) view?: 'all' | 'approve';
  @ApiPropertyOptional({ enum: [...EXIT_STATUSES, 'OPEN'] }) @IsOptional() @IsIn([...EXIT_STATUSES, 'OPEN']) status?: ExitStatus | 'OPEN';
}

export class ApproveExitDto {
  @ApiProperty() @IsISO8601(DATE) lastWorkingDay!: string;
  @ApiPropertyOptional({ description: 'No recovery for notice not served' }) @IsOptional() @IsBoolean() waiveNotice?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) note?: string | null;
}

export class UpdateExitDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601(DATE) lastWorkingDay?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() waiveNotice?: boolean;
  @ApiPropertyOptional({ nullable: true }) @optionalNullable @IsBoolean() eligibleForRehire?: boolean | null;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) rehireNote?: string | null;
}

export class CloseExitDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) reason!: string;
}

export class ClearanceItemDto {
  @ApiProperty({ enum: CLEARANCE_DEPARTMENTS }) @IsIn(CLEARANCE_DEPARTMENTS) department!: ClearanceDepartment;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) title!: string;
}

export class UpdateClearanceDto {
  @ApiProperty({ enum: CLEARANCE_STATUSES }) @IsIn(CLEARANCE_STATUSES) status!: ClearanceStatus;
  @ApiPropertyOptional({ description: 'Dues to recover in the settlement' }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) recoveryAmount?: number;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) note?: string | null;
}

export class FeedbackDto {
  @ApiProperty({ description: 'How likely you would recommend working here (0–10)' }) @Type(() => Number) @IsInt() @Min(0) @Max(10) wouldRecommend!: number;
  @ApiProperty() @IsBoolean() wouldRejoin!: boolean;
  @ApiPropertyOptional({ nullable: true }) @Text(2000) liked?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(2000) improve?: string | null;
}

export class AdjustmentLineDto {
  @ApiProperty({ example: 'Income tax (TDS)' }) @Transform(trim) @IsString() @Length(2, 120) label!: string;
  @ApiProperty({ enum: ['EARNING', 'DEDUCTION'] }) @IsIn(['EARNING', 'DEDUCTION']) kind!: 'EARNING' | 'DEDUCTION';
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount!: number;
}

export class CalculateSettlementDto {
  @ApiPropertyOptional({ enum: DAILY_RATE_BASES, default: 'BASIC_26' }) @IsOptional() @IsIn(DAILY_RATE_BASES) encashmentBasis?: DailyRateBasis;
  @ApiPropertyOptional({ enum: DAILY_RATE_BASES, default: 'GROSS_30' }) @IsOptional() @IsIn(DAILY_RATE_BASES) noticeBasis?: DailyRateBasis;
  @ApiPropertyOptional({ description: 'Override the gratuity eligibility (needs a note)' }) @IsOptional() @IsBoolean() includeGratuity?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) gratuityNote?: string | null;
  @ApiPropertyOptional({ type: [AdjustmentLineDto] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AdjustmentLineDto) adjustments?: AdjustmentLineDto[];
}

export class ReturnSettlementDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) note!: string;
}

export class PaySettlementDto {
  @ApiProperty() @IsISO8601(DATE) paidOn!: string;
  @ApiProperty({ description: 'Bank transfer reference' }) @Transform(trim) @IsString() @Length(2, 120) reference!: string;
}
