import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsISO8601, IsNumber, IsObject, Max, MaxLength, Min } from 'class-validator';
import type { TaxRuleSet } from '../../../contracts';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const rate = () => (target: object, key: string) => {
  IsNumber({ maxDecimalPlaces: 4 })(target, key);
  Min(0)(target, key);
  Max(0.5)(target, key);
};

export class ContributionRatesDto {
  @ApiProperty({ example: '2027-04-01', description: 'First day the rates apply (payroll for a month uses the set in force on its first day)' })
  @IsISO8601({ strict: true })
  effectiveFrom!: string;
  @ApiProperty({ example: 0.12 }) @rate() pfRate!: number;
  @ApiProperty({ example: 0.0833 }) @rate() epsRate!: number;
  @ApiProperty({ example: 15000 }) @IsInt() @Min(1) @Max(1_000_000) pfWageCeiling!: number;
  @ApiProperty({ example: 0.0075 }) @rate() esiEmployeeRate!: number;
  @ApiProperty({ example: 0.0325 }) @rate() esiEmployerRate!: number;
  @ApiProperty({ example: 21000 }) @IsInt() @Min(1) @Max(1_000_000) esiWageLimit!: number;
  @ApiPropertyOptional({ nullable: true, example: 'EPFO notification G.S.R. 609(E)' }) @Transform(trim) @Transform(emptyToNull) @optionalNullable @MaxLength(300) source?: string | null;
}

export class TaxRulesDto {
  @ApiProperty({ description: 'Both regimes and the cess, as returned by GET /platform/statutory-rates' })
  @IsObject()
  rules!: TaxRuleSet;
  @ApiPropertyOptional({ nullable: true, example: 'Finance Act 2027' }) @Transform(trim) @Transform(emptyToNull) @optionalNullable @MaxLength(300) source?: string | null;
}
