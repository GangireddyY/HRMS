import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import {
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_REQUEST_STATUSES,
  ASSET_STATUSES,
  HELPDESK_CATEGORIES,
  HELPDESK_PRIORITIES,
  HELPDESK_STATUSES,
  TRAVEL_MODES,
  TRAVEL_STATUSES,
  type AssetCategory,
  type AssetCondition,
  type AssetRequestStatus,
  type AssetStatus,
  type HelpdeskCategory,
  type HelpdeskPriority,
  type HelpdeskStatus,
  type TravelMode,
  type TravelStatus,
} from '../../contracts';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { emptyToNull, optionalNullable, trim } from '../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const Money = () => (target: object, key: string) => {
  Type(() => Number)(target, key);
  IsNumber({ maxDecimalPlaces: 2 })(target, key);
  Min(0)(target, key);
  Max(100_000_000)(target, key);
};

// ---- Assets ------------------------------------------------------------------------------------

export class AssetDto {
  @ApiPropertyOptional({ nullable: true, description: 'Asset tag (generated as AST-0001… when empty)' }) @Transform(emptyToNull) @optionalNullable @IsString() @Length(2, 20) tag?: string | null;
  @ApiProperty({ example: 'MacBook Pro 14"' }) @Transform(trim) @IsString() @Length(2, 150) name!: string;
  @ApiProperty({ enum: ASSET_CATEGORIES }) @IsIn(ASSET_CATEGORIES) category!: AssetCategory;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100) serialNumber?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(150) model?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) purchaseDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @Money() purchaseCost?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsISO8601(DATE) warrantyUntil?: string | null;
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS }) @IsOptional() @IsIn(ASSET_CONDITIONS) condition?: AssetCondition;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsUUID() locationId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) notes?: string | null;
}
export class UpdateAssetDto extends PartialType(AssetDto) {}

export class AssetQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ASSET_STATUSES }) @IsOptional() @IsIn(ASSET_STATUSES) status?: AssetStatus;
  @ApiPropertyOptional({ enum: ASSET_CATEGORIES }) @IsOptional() @IsIn(ASSET_CATEGORIES) category?: AssetCategory;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
}

export class AssignAssetDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional({ enum: ASSET_CONDITIONS }) @IsOptional() @IsIn(ASSET_CONDITIONS) condition?: AssetCondition;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class ReturnAssetDto {
  @ApiProperty({ enum: ASSET_CONDITIONS }) @IsIn(ASSET_CONDITIONS) condition!: AssetCondition;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class AssetStatusDto {
  @ApiProperty({ enum: ['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'LOST'] }) @IsIn(['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'LOST']) status!: Exclude<AssetStatus, 'ASSIGNED'>;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class AssetRequestDto {
  @ApiProperty({ enum: ASSET_CATEGORIES }) @IsIn(ASSET_CATEGORIES) category!: AssetCategory;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason!: string;
}

export class AssetRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'all'], default: 'mine' }) @IsOptional() @IsIn(['mine', 'all']) view?: 'mine' | 'all';
  @ApiPropertyOptional({ enum: ASSET_REQUEST_STATUSES }) @IsOptional() @IsIn(ASSET_REQUEST_STATUSES) status?: AssetRequestStatus;
}

export class FulfilAssetRequestDto {
  @ApiProperty({ description: 'An in-stock asset to hand over' }) @IsUUID() assetId!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class NoteDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class OptionalNoteDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

// ---- Helpdesk ----------------------------------------------------------------------------------

export class TicketDto {
  @ApiProperty({ enum: HELPDESK_CATEGORIES }) @IsIn(HELPDESK_CATEGORIES) category!: HelpdeskCategory;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 200) subject!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 5000) description!: string;
  @ApiPropertyOptional({ enum: HELPDESK_PRIORITIES, default: 'NORMAL' }) @IsOptional() @IsIn(HELPDESK_PRIORITIES) priority?: HelpdeskPriority;
}

export class TicketQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'queue'], default: 'mine', description: 'queue = all tickets (helpdesk.manage)' }) @IsOptional() @IsIn(['mine', 'queue']) view?: 'mine' | 'queue';
  @ApiPropertyOptional({ enum: [...HELPDESK_STATUSES, 'ACTIVE'], description: 'ACTIVE = open, in progress or waiting' }) @IsOptional() @IsIn([...HELPDESK_STATUSES, 'ACTIVE']) status?: HelpdeskStatus | 'ACTIVE';
  @ApiPropertyOptional({ enum: ['me', 'unassigned'] }) @IsOptional() @IsIn(['me', 'unassigned']) assignee?: 'me' | 'unassigned';
  @ApiPropertyOptional({ enum: HELPDESK_CATEGORIES }) @IsOptional() @IsIn(HELPDESK_CATEGORIES) category?: HelpdeskCategory;
}

export class TicketReplyDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body!: string;
  @ApiPropertyOptional({ description: 'Note for agents only' }) @IsOptional() @IsBoolean() internal?: boolean;
  @ApiPropertyOptional({ enum: HELPDESK_STATUSES, description: 'Agents: set the status with the reply' }) @IsOptional() @IsIn(HELPDESK_STATUSES) status?: HelpdeskStatus;
}

export class TicketUpdateDto {
  @ApiPropertyOptional({ enum: HELPDESK_STATUSES }) @IsOptional() @IsIn(HELPDESK_STATUSES) status?: HelpdeskStatus;
  @ApiPropertyOptional({ nullable: true, description: 'User id of the agent' }) @Transform(emptyToNull) @optionalNullable @IsUUID() assigneeId?: string | null;
  @ApiPropertyOptional({ enum: HELPDESK_PRIORITIES }) @IsOptional() @IsIn(HELPDESK_PRIORITIES) priority?: HelpdeskPriority;
}

export class TicketRatingDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) comment?: string | null;
}

// ---- Travel ------------------------------------------------------------------------------------

export class TravelRequestDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 500) purpose!: string;
  @ApiProperty({ example: 'Bengaluru' }) @Transform(trim) @IsString() @Length(2, 100) fromCity!: string;
  @ApiProperty({ example: 'Mumbai' }) @Transform(trim) @IsString() @Length(2, 100) toCity!: string;
  @ApiProperty({ example: '2026-11-20' }) @IsISO8601(DATE) departureDate!: string;
  @ApiProperty({ example: '2026-11-22' }) @IsISO8601(DATE) returnDate!: string;
  @ApiProperty({ enum: TRAVEL_MODES }) @IsIn(TRAVEL_MODES) mode!: TravelMode;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() needsAccommodation?: boolean;
  @ApiProperty({ description: 'Estimated total cost' }) @Money() estimatedCost!: number;
  @ApiPropertyOptional({ description: 'Advance requested (up to the estimate)' }) @IsOptional() @Money() advanceAmount?: number;
}

export class TravelQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team', 'all'], default: 'mine', description: 'team = requests you can approve; all = the travel desk' }) @IsOptional() @IsIn(['mine', 'team', 'all']) view?: 'mine' | 'team' | 'all';
  @ApiPropertyOptional({ enum: TRAVEL_STATUSES }) @IsOptional() @IsIn(TRAVEL_STATUSES) status?: TravelStatus;
}

export class TravelDeskDto {
  @ApiPropertyOptional({ nullable: true, description: 'Tickets, hotel and other booking details for the traveller' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(2000) bookingNotes?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Payment reference when the advance is paid' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(100) advanceReference?: string | null;
}
