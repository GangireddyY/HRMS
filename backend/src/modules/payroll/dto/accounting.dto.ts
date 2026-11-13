import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { LEDGER_NAME_PATTERN, LEDGER_SLOTS, type LedgerSlot } from '../../../contracts';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const LEDGER_MESSAGE = 'Use up to 100 characters, without < > " or \\';

export class LedgerNameDto {
  @ApiProperty({ enum: LEDGER_SLOTS }) @IsIn(LEDGER_SLOTS) slot: LedgerSlot;
  @ApiProperty() @Transform(trim) @IsString() @Matches(LEDGER_NAME_PATTERN, { message: LEDGER_MESSAGE }) name: string;
}

export class EarningLedgerDto {
  @ApiProperty({ description: 'Salary component code, or ARREARS, OVERTIME, ENCASHMENT, ADJUSTMENT' }) @Transform(trim) @IsString() @Matches(/^[A-Z0-9_]{1,20}$/) code: string;
  @ApiProperty() @Transform(trim) @IsString() @Matches(LEDGER_NAME_PATTERN, { message: LEDGER_MESSAGE }) name: string;
}

export class AccountingSettingsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Company name exactly as in Tally' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @Matches(LEDGER_NAME_PATTERN, { message: LEDGER_MESSAGE })
  tallyCompany?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Matches(LEDGER_NAME_PATTERN, { message: LEDGER_MESSAGE }) @MaxLength(60) voucherType?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() costCentres?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Matches(LEDGER_NAME_PATTERN, { message: LEDGER_MESSAGE }) costCategory?: string;
  @ApiPropertyOptional({ type: [LedgerNameDto] }) @IsOptional() @IsArray() @ArrayMaxSize(LEDGER_SLOTS.length) @ValidateNested({ each: true }) @Type(() => LedgerNameDto) ledgers?: LedgerNameDto[];
  @ApiPropertyOptional({ type: [EarningLedgerDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => EarningLedgerDto) earningLedgers?: EarningLedgerDto[];
}

export class TallyExportQueryDto {
  @ApiPropertyOptional({ enum: ['vouchers', 'masters'], default: 'vouchers' }) @IsOptional() @IsIn(['vouchers', 'masters']) part?: 'vouchers' | 'masters';
}
