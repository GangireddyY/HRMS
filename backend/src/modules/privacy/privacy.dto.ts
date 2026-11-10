import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PrivacySettingsDto {
  @ApiPropertyOptional({ description: 'Years statutory records of former employees are kept after exit (payroll and PF records: typically 8)', example: 8 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) exitedRetentionYears?: number;

  @ApiPropertyOptional({ description: 'Months after their last activity that candidates who were not hired are anonymized (0 = never automatically)', example: 12 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120) candidateRetentionMonths?: number;
}

export class EraseEmployeeDto {
  @ApiProperty({ description: "The employee's code, typed to confirm" })
  @IsString() @MaxLength(30) confirm!: string;
}
