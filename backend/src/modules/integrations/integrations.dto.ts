import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';
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

/** Save Vector workspace embed keys (from Vector → Organization settings → Integrations → Workspace embed). */
export class VectorConnectorDto {
  @ApiProperty({ example: 'https://vector.example.com/api' }) @Transform(trim) @IsUrl({ require_protocol: true, protocols: ['https', 'http'], require_tld: false }) @MaxLength(300) apiBaseUrl!: string;
  @ApiPropertyOptional({ example: 'https://vector.example.com', description: 'Vector UI origin for the embedded workspace' })
  @IsOptional() @Transform(emptyToNull) @optionalNullable @IsUrl({ require_protocol: true, protocols: ['https', 'http'], require_tld: false }) @MaxLength(300) appOrigin?: string | null;
  @ApiProperty({ example: 'pk_live_…' }) @Transform(trim) @IsString() @Matches(/^pk_live_/, { message: 'Must start with pk_live_' }) @Length(16, 64) publishableKey!: string;
  @ApiPropertyOptional({ description: 'Required on first save; leave empty to keep the stored secret' }) @IsOptional() @Transform(emptyToNull) @optionalNullable @IsString() @Matches(/^sk_live_/, { message: 'Must start with sk_live_' }) @MinLength(24) @MaxLength(80) secretKey?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ type: [String], description: 'Organization role ids that may open Vector (in addition to people with integration.manage)' })
  @IsOptional() @IsArray() @ArrayMaxSize(80) @ArrayUnique() @IsUUID('4', { each: true }) allowedRoleIds?: string[];
}

/** Open Vector as a Vector organization admin using the stored embed keys. */
export class VectorConnectDto {
  @ApiProperty({ example: 'admin@acme.com' }) @Transform(trim) @IsEmail() @MaxLength(190) email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @ApiPropertyOptional({ description: 'Path inside Vector after connect' }) @IsOptional() @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) path?: string | null;
}

/** Block or restore one person’s Vector access (role grants still apply after restore). */
export class VectorAccessUserDto {
  @ApiProperty() @IsUUID('4') userId!: string;
}
