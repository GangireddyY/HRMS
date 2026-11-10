import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { emptyToNull, optionalNullable } from '../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };

export class CreateDelegationDto {
  @ApiProperty({ description: 'The colleague who approves for you' }) @IsUUID() delegateEmployeeId!: string;
  @ApiProperty({ example: '2026-11-16' }) @IsISO8601(DATE) startsOn!: string;
  @ApiProperty({ example: '2026-11-27', description: 'Last day (inclusive)' }) @IsISO8601(DATE) endsOn!: string;
  @ApiPropertyOptional({ nullable: true, example: 'On leave' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) reason?: string | null;
}

export class CandidateQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
}
