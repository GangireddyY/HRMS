import { applyDecorators } from '@nestjs/common';
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BENEFIT_ENROLLMENT_STATUSES,
  BENEFIT_PLAN_STATUSES,
  BENEFIT_TYPES,
  DEPENDENT_RELATIONS,
  EMPLOYMENT_TYPES,
  LIFE_EVENTS,
  MAX_PLAN_OPTIONS,
  type BenefitEnrollmentStatus,
  type BenefitPlanStatus,
  type BenefitType,
  type DependentRelation,
  type EmploymentType,
  type LifeEvent,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const MONTHLY_MAX = 1_000_000;
const COVER_MAX = 1_000_000_000;
const Ids = (max: number) => applyDecorators(optionalNullable, IsArray(), ArrayMaxSize(max), ArrayUnique(), IsUUID('4', { each: true }));
const Text = (max: number) => applyDecorators(Transform(emptyToNull), optionalNullable, IsString(), MaxLength(max));

export class PlanOptionDto {
  @ApiPropertyOptional({ description: 'Existing option (omit for a new one)' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ example: 'Employee + spouse + 2 children' }) @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Sum insured / benefit amount' })
  @optionalNullable
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(COVER_MAX)
  coverageAmount?: number | null;
  @ApiProperty({ description: 'Deducted from salary every month' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MONTHLY_MAX) employeeMonthly!: number;
  @ApiProperty({ description: 'Paid by the employer every month' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MONTHLY_MAX) employerMonthly!: number;
  @ApiProperty({ enum: DEPENDENT_RELATIONS, isArray: true }) @IsArray() @ArrayUnique() @IsIn(DEPENDENT_RELATIONS, { each: true }) allowedRelations!: DependentRelation[];
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(10) maxDependents!: number;
  @ApiPropertyOptional({ description: 'Used when HR enrols everyone in a mandatory plan' }) @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class PlanDto {
  @ApiProperty({ example: 'Group health insurance 2026-27' }) @Transform(trim) @IsString() @Length(3, 150) name!: string;
  @ApiProperty({ enum: BENEFIT_TYPES }) @IsIn(BENEFIT_TYPES) type!: BenefitType;
  @ApiPropertyOptional({ nullable: true }) @Text(150) provider?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(80) policyNumber?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(4000) description?: string | null;
  @ApiProperty({ example: '2026-04-01' }) @IsISO8601(DATE) coverageStartsOn!: string;
  @ApiProperty({ example: '2027-03-31' }) @IsISO8601(DATE) coverageEndsOn!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) enrollmentOpensOn?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) enrollmentClosesOn?: string | null;
  @ApiPropertyOptional({ description: 'Everyone eligible is covered and it cannot be waived' }) @IsOptional() @IsBoolean() mandatory?: boolean;
  @ApiPropertyOptional({ description: 'HR approves every enrolment' }) @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @ApiPropertyOptional({ nullable: true, enum: EMPLOYMENT_TYPES, isArray: true })
  @optionalNullable
  @IsArray()
  @ArrayUnique()
  @IsIn(EMPLOYMENT_TYPES, { each: true })
  employmentTypes?: EmploymentType[] | null;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(200) departmentIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(200) locationIds?: string[] | null;
  @ApiPropertyOptional({ nullable: true, type: [String] }) @Ids(100) gradeIds?: string[] | null;
  @ApiPropertyOptional({ description: 'Days after joining before the employee is eligible' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) waitingDays?: number;
  @ApiPropertyOptional({ nullable: true, description: 'Children are covered up to this age' }) @optionalNullable @Type(() => Number) @IsInt() @Min(1) @Max(30) maxChildAge?: number | null;
  @ApiProperty({ type: [PlanOptionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PLAN_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => PlanOptionDto)
  options!: PlanOptionDto[];
}

export class UpdatePlanDto extends PartialType(PlanDto) {}

export class PlanQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BENEFIT_PLAN_STATUSES }) @IsOptional() @IsIn(BENEFIT_PLAN_STATUSES) status?: BenefitPlanStatus;
}

export class EnrollDto {
  @ApiProperty() @IsUUID() optionId!: string;
  @ApiProperty({ type: [String], description: "Family members (from the employee's family details) to cover" })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  dependentIds!: string[];
  @ApiPropertyOptional({ nullable: true, enum: LIFE_EVENTS, description: 'Outside the enrolment window: the life event that allows the change' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsIn(LIFE_EVENTS)
  lifeEvent?: LifeEvent | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) lifeEventDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) note?: string | null;
}

export class WaiveDto {
  @ApiPropertyOptional({ nullable: true, description: 'e.g. covered under a spouse’s policy' }) @Text(1000) note?: string | null;
}

export class EnrollmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() planId?: string;
  @ApiPropertyOptional({ enum: BENEFIT_ENROLLMENT_STATUSES }) @IsOptional() @IsIn(BENEFIT_ENROLLMENT_STATUSES) status?: BenefitEnrollmentStatus;
}

export class DecisionDto {
  @ApiPropertyOptional({ nullable: true }) @Text(1000) note?: string | null;
}

export class RejectDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) note!: string;
}

export class EndEnrollmentDto {
  @ApiProperty({ description: 'Last day of coverage' }) @IsISO8601(DATE) effectiveTo!: string;
  @ApiPropertyOptional({ nullable: true }) @Text(1000) note?: string | null;
}
