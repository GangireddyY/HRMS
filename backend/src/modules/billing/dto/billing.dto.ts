import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { BILLING_CYCLES, INVOICE_MAX_LINES, INVOICE_STATUSES, PAYMENT_METHODS, SUBSCRIPTION_STATUSES, type BillingCycle, type InvoiceStatus, type PaymentMethod, type SubscriptionStatus } from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const DATE = { strict: true } as const;

export class BillingContactDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(200)
  billingName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value)) @ValidateIf((_o, v) => v !== null) @IsEmail() @MaxLength(254)
  billingEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500)
  billingAddress?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'GSTIN or other tax registration' })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value)) @ValidateIf((_o, v) => v !== null) @Matches(/^[A-Z0-9-]{5,20}$/, { message: 'Enter the tax registration number (letters and digits)' })
  billingTaxId?: string | null;
}

export class UpdateSubscriptionDto extends BillingContactDto {
  @ApiPropertyOptional({ enum: SUBSCRIPTION_STATUSES })
  @IsOptional() @IsIn(SUBSCRIPTION_STATUSES)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ enum: BILLING_CYCLES })
  @IsOptional() @IsIn(BILLING_CYCLES)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ nullable: true, description: 'Seat limit; null = the plan’s user limit' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(1_000_000)
  seats?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Monthly price; null = the plan’s price' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000)
  pricePerMonth?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  discountPct?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  taxRatePct?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(90)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601(DATE)
  trialEndsOn?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Start of the next period to invoice' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsISO8601(DATE)
  nextPeriodStart?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class InvoiceLineDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 200)
  description!: string;

  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000)
  quantity!: number;

  @ApiProperty({ description: 'Negative for a credit' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-100_000_000) @Max(100_000_000)
  unitPrice!: number;
}

export class CreateInvoiceDto {
  @ApiPropertyOptional({ description: 'Defaults to the subscription’s next period' })
  @IsOptional() @IsISO8601(DATE)
  periodStart?: string;

  @ApiPropertyOptional({ type: [InvoiceLineDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(INVOICE_MAX_LINES - 1) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto)
  extraLines?: InvoiceLineDto[];

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional({ type: [InvoiceLineDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(INVOICE_MAX_LINES) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  taxRatePct?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class RecordPaymentDto {
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  amount!: number;

  @ApiProperty() @IsISO8601(DATE)
  paidOn!: string;

  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  note?: string;
}

export class VoidInvoiceDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500)
  reason!: string;
}

export class InvoiceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [...INVOICE_STATUSES, 'OVERDUE'] })
  @IsOptional() @IsIn([...INVOICE_STATUSES, 'OVERDUE'])
  status?: InvoiceStatus | 'OVERDUE';

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  organizationId?: string;
}
