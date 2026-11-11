import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { APPROVAL_CHAIN_MAX_STEPS, APPROVAL_SUBJECTS, APPROVER_KINDS, type ApprovalSubject, type ApproverKind } from '../../contracts';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ApprovalChainStepDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 60)
  label!: string;

  @ApiProperty({ enum: APPROVER_KINDS }) @IsIn(APPROVER_KINDS)
  approver!: ApproverKind;

  @ApiPropertyOptional({ description: 'PERMISSION: who holds it department- or organization-wide' })
  @IsOptional() @IsString() @Length(3, 80)
  permission?: string;

  @ApiPropertyOptional({ description: 'USER: the approver' })
  @IsOptional() @IsUUID()
  membershipId?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Escalate when undecided this many hours' })
  @IsOptional() @IsInt() @Min(1) @Max(720)
  slaHours?: number | null;
}

export class ApprovalChainConditionsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(365)
  minDays?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  minAmount?: number;

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true })
  leaveTypeIds?: string[];

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  categories?: string[];
}

export class ApprovalChainDto {
  @ApiProperty({ enum: APPROVAL_SUBJECTS }) @IsIn(APPROVAL_SUBJECTS)
  subject!: ApprovalSubject;

  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(999)
  priority?: number;

  @ApiPropertyOptional({ type: ApprovalChainConditionsDto }) @IsOptional() @ValidateNested() @Type(() => ApprovalChainConditionsDto)
  conditions?: ApprovalChainConditionsDto;

  @ApiProperty({ type: [ApprovalChainStepDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(APPROVAL_CHAIN_MAX_STEPS) @ValidateNested({ each: true }) @Type(() => ApprovalChainStepDto)
  steps!: ApprovalChainStepDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ApprovalChainQueryDto {
  @ApiPropertyOptional({ enum: APPROVAL_SUBJECTS }) @IsOptional() @IsIn(APPROVAL_SUBJECTS)
  subject?: ApprovalSubject;
}
