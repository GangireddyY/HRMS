import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUrl, Length, Matches, MaxLength } from 'class-validator';
import { WEBHOOK_EVENT_PATTERN, WEBHOOK_FORMATS, type WebhookFormat } from '../../contracts';
import { emptyToNull, optionalNullable, trim } from '../../common/validation/transforms';

export class ApiKeyDto {
  @ApiProperty({ example: 'Payroll export to Tally' }) @Transform(trim) @IsString() @Length(2, 100) name!: string;
  @ApiProperty({ type: [String], example: ['employee.view', 'leave.view'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ArrayUnique() @IsString({ each: true }) permissions!: string[];
  @ApiPropertyOptional({ nullable: true, description: 'Stops working after this date' }) @Transform(emptyToNull) @optionalNullable @IsISO8601({ strict: true }) expiresAt?: string | null;
}

export class WebhookDto {
  @ApiProperty({ example: 'https://hooks.example.com/hrms' }) @Transform(trim) @IsUrl({ require_protocol: true, protocols: ['https', 'http'], require_tld: false }) @MaxLength(500) url!: string;
  @ApiPropertyOptional({ enum: WEBHOOK_FORMATS, default: 'JSON', description: 'JSON: signed event. SLACK / TEAMS: a chat message to an incoming-webhook URL. Cannot be changed later.' })
  @IsOptional() @IsIn(WEBHOOK_FORMATS) format?: WebhookFormat;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200) description?: string | null;
  @ApiProperty({ type: [String], example: ['leave.*', 'employee.created'] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ArrayUnique() @IsString({ each: true }) @Matches(WEBHOOK_EVENT_PATTERN, { each: true, message: 'Use "*", "leave.*" or an exact event name' }) events!: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsUrl({ require_protocol: true, protocols: ['https', 'http'], require_tld: false }) @MaxLength(500) url?: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(200) description?: string | null;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ArrayUnique() @IsString({ each: true }) @Matches(WEBHOOK_EVENT_PATTERN, { each: true, message: 'Use "*", "leave.*" or an exact event name' }) events?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}
