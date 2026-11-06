import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import {
  GRIEVANCE_CATEGORIES,
  GRIEVANCE_OUTCOMES,
  GRIEVANCE_PRIORITIES,
  GRIEVANCE_STATUSES,
  GRIEVANCE_VISIBILITIES,
  type GrievanceCategory,
  type GrievanceOutcome,
  type GrievancePriority,
  type GrievanceStatus,
  type GrievanceVisibility,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const queryBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);
const VIEWS = ['assigned', 'all', 'posh'] as const;
export type GrievanceView = (typeof VIEWS)[number];

export class GrievanceDto {
  @ApiProperty({ enum: GRIEVANCE_CATEGORIES, description: 'POSH = sexual harassment; handled only by the Internal Committee' })
  @IsIn(GRIEVANCE_CATEGORIES)
  category!: GrievanceCategory;
  @ApiProperty({ description: 'Short subject (shown in case lists)' }) @Transform(trim) @IsString() @Length(5, 150) subject!: string;
  @ApiProperty({ description: 'What happened (stored encrypted)' }) @Transform(trim) @IsString() @Length(20, 10000) description!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Colleague the complaint is about' }) @Transform(emptyToNull) @optionalNullable @IsUUID() respondentId?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Someone outside the employee directory (e.g. a client or vendor)' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(150)
  respondentName?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '2026-10-20' }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) incidentDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200) incidentLocation?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) witnesses?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'POSH: why the complaint is made more than 3 months after the incident' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(2000)
  delayReason?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'POSH: interim relief requested during the inquiry (section 12), e.g. a transfer or leave' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(2000)
  interimRelief?: string | null;
  @ApiPropertyOptional({ description: 'POSH: the complainant asks for conciliation before an inquiry (section 10)' }) @IsOptional() @IsBoolean() conciliationRequested?: boolean;
}

export class GrievanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VIEWS, default: 'assigned', description: 'assigned to me · all grievances (grievance.manage) · POSH complaints (grievance.posh.access)' })
  @IsOptional()
  @IsIn(VIEWS)
  view?: GrievanceView;
  @ApiPropertyOptional({ enum: [...GRIEVANCE_STATUSES, 'OPEN'] }) @IsOptional() @IsIn([...GRIEVANCE_STATUSES, 'OPEN']) status?: GrievanceStatus | 'OPEN';
  @ApiPropertyOptional({ enum: GRIEVANCE_CATEGORIES }) @IsOptional() @IsIn(GRIEVANCE_CATEGORIES) category?: GrievanceCategory;
  @ApiPropertyOptional({ enum: GRIEVANCE_PRIORITIES }) @IsOptional() @IsIn(GRIEVANCE_PRIORITIES) priority?: GrievancePriority;
  @ApiPropertyOptional({ description: 'Open cases past their due date' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() overdue?: boolean;
  @ApiPropertyOptional({ description: 'Not assigned to anyone' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() unassigned?: boolean;
}

export class NoteDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body!: string;
  @ApiPropertyOptional({ enum: GRIEVANCE_VISIBILITIES, default: 'SHARED', description: 'INTERNAL notes are only for the people handling the case' })
  @IsOptional()
  @IsIn(GRIEVANCE_VISIBILITIES)
  visibility?: GrievanceVisibility;
}

export class AttachmentDto {
  @ApiPropertyOptional({ enum: GRIEVANCE_VISIBILITIES, default: 'SHARED' }) @IsOptional() @IsIn(GRIEVANCE_VISIBILITIES) visibility?: GrievanceVisibility;
}

export class AssignDto {
  @ApiProperty({ nullable: true, description: 'User handling the case; null to unassign' }) @Transform(emptyToNull) @optionalNullable @IsUUID() assigneeUserId!: string | null;
}

export class UpdateGrievanceDto {
  @ApiProperty({ enum: GRIEVANCE_PRIORITIES }) @IsIn(GRIEVANCE_PRIORITIES) priority!: GrievancePriority;
}

export class ResolveDto {
  @ApiProperty({ enum: GRIEVANCE_OUTCOMES }) @IsIn(GRIEVANCE_OUTCOMES) outcome!: GrievanceOutcome;
  @ApiProperty({ description: 'Findings and decision, shared with the complainant' }) @Transform(trim) @IsString() @Length(10, 5000) summary!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Actions taken or recommended (internal)' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(5000) actions?: string | null;
}

export class ReasonDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) reason?: string | null;
}

export class ReopenDto {
  @ApiProperty({ description: 'Why the resolution does not address the grievance' }) @Transform(trim) @IsString() @Length(10, 2000) reason!: string;
}

export class ColleagueQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class PoshReportQueryDto {
  @ApiPropertyOptional({ example: 2026 }) @IsOptional() @Transform(({ value }) => (value === undefined ? value : Number(value))) @IsIn(Array.from({ length: 30 }, (_, i) => 2013 + i)) year?: number;
}
