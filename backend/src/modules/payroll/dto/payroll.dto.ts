import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  ADJUSTMENT_CATEGORIES,
  ADVANCE_MAX_TENURE_MONTHS,
  BANK_FILE_FORMATS,
  BONUS_BASES,
  COMPONENT_CALCULATIONS,
  DAILY_RATE_BASES,
  PAYSLIP_PDF_PASSWORDS,
  type AdjustmentCategory,
  type BankFileFormat,
  type BonusBasis,
  type DailyRateBasis,
  type PayslipPdfPassword,
  LOAN_MAX_INTEREST_RATE,
  LOAN_MAX_PRINCIPAL,
  LOAN_MAX_TENURE_MONTHS,
  LOAN_STATUSES,
  LOAN_TYPES,
  OVERTIME_BASES,
  PAYROLL_RUN_STATUSES,
  PROFESSIONAL_TAX_STATES,
  REIMBURSEMENT_CATEGORIES,
  REIMBURSEMENT_STATUSES,
  TAX_PROOF_SECTIONS,
  TAX_PROOF_STATUSES,
  TAX_REGIMES,
  TIMESHEET_MISSED_ACTIONS,
  type TaxProofSection,
  type TaxProofStatus,
  type ComponentCalculation,
  type LoanStatus,
  type LoanType,
  type OvertimeBasis,
  type PayrollRunStatus,
  type ReimbursementCategory,
  type ReimbursementStatus,
  type TaxRegime,
  type TimesheetMissedAction,
} from '../../../contracts';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { emptyToNull, emptyToNullUpper, optionalNullable, trim, upper } from '../../../common/validation/transforms';

const DATE = { strict: true, strictSeparator: true };
const MAX_AMOUNT = 1_000_000_000;
/** Non-negative amount with up to two decimals (defaults to 0 when omitted). */
const Amount = () =>
  applyDecorators(
    IsOptional(),
    Type(() => Number),
    IsNumber({ maxDecimalPlaces: 2 }),
    Min(0),
    Max(MAX_AMOUNT),
  );
const queryBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);
const PT_CODES = PROFESSIONAL_TAX_STATES.map((s) => s.code);

// ---- Settings ----------------------------------------------------------------------------------

export class PayrollSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pfEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Contribute on PF wages up to ₹15,000 only' }) @IsOptional() @IsBoolean() pfRestrictToCeiling?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() esiEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ptEnabled?: boolean;
  @ApiPropertyOptional({ nullable: true, enum: PT_CODES, description: 'Professional tax state when the work location has none' })
  @Transform(emptyToNullUpper)
  @optionalNullable
  @IsIn(PT_CODES)
  ptState?: string | null;
  @ApiPropertyOptional({ description: 'Loss of pay from attendance absences as well as unpaid leave (the month must be closed)' })
  @IsOptional()
  @IsBoolean()
  lopFromAttendance?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNullUpper) @optionalNullable @IsString() @MaxLength(30) pfEstablishmentCode?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNullUpper) @optionalNullable @IsString() @MaxLength(30) esiEmployerCode?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Tax deduction account number, e.g. BLRA12345B' })
  @Transform(emptyToNullUpper)
  @optionalNullable
  @Matches(/^[A-Z]{4}[0-9]{5}[A-Z]$/, { message: 'tan must look like BLRA12345B' })
  tan?: string | null;
  @ApiPropertyOptional({ description: 'Overtime is paid at this multiple of the hourly rate (Factories Act: twice)', default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(5)
  overtimeMultiplier?: number;
  @ApiPropertyOptional({ enum: OVERTIME_BASES, description: 'Hourly rate = monthly Basic or gross ÷ 26 days ÷ 8 hours' }) @IsOptional() @IsIn(OVERTIME_BASES) overtimeBasis?: OvertimeBasis;
  @ApiPropertyOptional({ description: 'Everyone submits a weekly timesheet, reviewed before payroll' }) @IsOptional() @IsBoolean() timesheetsRequired?: boolean;
  @ApiPropertyOptional({ example: '2026-11-09', description: 'First week that needs a timesheet (moved to its Monday); defaults to the week the rule is switched on' })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  timesheetsFrom?: string;
  @ApiPropertyOptional({ description: 'Due on this weekday after the week ends (0 = Sunday … 6 = Saturday)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  timesheetDueWeekday?: number;
  @ApiPropertyOptional({ enum: TIMESHEET_MISSED_ACTIONS, description: 'FLAG: warn on the payslip; LOP: working days of the week are unpaid; HOLD: hold the salary in the run' })
  @IsOptional()
  @IsIn(TIMESHEET_MISSED_ACTIONS)
  timesheetMissedAction?: TimesheetMissedAction;
  @ApiPropertyOptional({ description: 'Remind people on the due day (9:00) and the day after; managers get a summary of their team', default: true })
  @IsOptional()
  @IsBoolean()
  timesheetAutoRemind?: boolean;
  @ApiPropertyOptional({
    nullable: true,
    example: 15,
    description: 'Raises above this percent need approval by someone with employee.salary.approve; null = no approval step. Raising or removing it needs that permission too',
  })
  @optionalNullable
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(500)
  salaryApprovalThresholdPct?: number | null;
  @ApiPropertyOptional({ description: 'Deduct the labour welfare fund of the work location’s state (in the months it is collected)' }) @IsOptional() @IsBoolean() lwfEnabled?: boolean;
  @ApiPropertyOptional({ nullable: true, example: 1, description: 'From this calendar month to March, income tax uses accepted proofs only (e.g. 1 = January); null = declarations all year' })
  @optionalNullable
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  proofsFromMonth?: number | null;
  @ApiPropertyOptional({ enum: DAILY_RATE_BASES, description: 'Daily rate for leave encashed while in service' }) @IsOptional() @IsIn(DAILY_RATE_BASES) leaveEncashmentBasis?: DailyRateBasis;
  @ApiPropertyOptional({ description: 'Email each employee their payslip PDF when a run is approved' }) @IsOptional() @IsBoolean() payslipEmailEnabled?: boolean;
  @ApiPropertyOptional({ enum: PAYSLIP_PDF_PASSWORDS, description: 'DOB = the PDF opens with the date of birth (DDMMYYYY)' }) @IsOptional() @IsIn(PAYSLIP_PDF_PASSWORDS) payslipPdfPassword?: PayslipPdfPassword;
}

// ---- Components & structures -------------------------------------------------------------------

export class ComponentDto {
  @ApiProperty({ example: 'LTA' }) @Transform(upper) @Matches(/^[A-Z][A-Z0-9_]{1,19}$/, { message: 'code must be 2–20 capital letters, digits or underscores' }) code!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) description?: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['BASIC', 'HRA'] }) @Transform(emptyToNull) @optionalNullable @IsIn(['BASIC', 'HRA']) role?: 'BASIC' | 'HRA' | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() taxable?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Counts towards PF wages' }) @IsOptional() @IsBoolean() pfWage?: boolean;
  @ApiPropertyOptional({ default: true, description: 'Counts towards ESI wages' }) @IsOptional() @IsBoolean() esiWage?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateComponentDto extends PartialType(OmitType(ComponentDto, ['code'] as const)) {}

export class StructureLineDto {
  @ApiProperty() @IsUUID() componentId!: string;
  @ApiProperty({ enum: COMPONENT_CALCULATIONS }) @IsIn(COMPONENT_CALCULATIONS) calculation!: ComponentCalculation;
  @ApiPropertyOptional({ nullable: true, description: 'Percentage (0–100) or monthly amount; omitted for BALANCE' })
  @optionalNullable
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  value?: number | null;
}

export class StructureDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [StructureLineDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StructureLineDto)
  lines!: StructureLineDto[];
}

export class UpdateStructureDto extends PartialType(StructureDto) {}

// ---- Salaries ----------------------------------------------------------------------------------

export class SalaryPreviewDto {
  @ApiProperty() @IsUUID() structureId!: string;
  @ApiProperty({ description: 'Annual cost to company' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(MAX_AMOUNT) annualCtc!: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() pfApplicable?: boolean;
}

export class SalaryDto extends SalaryPreviewDto {
  @ApiProperty({ example: '2026-11-01' }) @IsISO8601(DATE) effectiveFrom!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Annual revision' }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) reason?: string | null;
}

export class SalaryRevisionQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'], default: 'PENDING' })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ALL';
}

export class ReviewSalaryRevisionDto {
  @ApiPropertyOptional({ nullable: true, description: 'Required when rejecting' })
  @Transform(emptyToNull)
  @optionalNullable
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class SalaryListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ description: 'Only active employees without a salary' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() missing?: boolean;
}

// ---- Tax declarations --------------------------------------------------------------------------

export class FinancialYearQueryDto {
  @ApiPropertyOptional({ description: 'Starting year of the financial year (2026 = FY 2026-27); defaults to the current one' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fy?: number;
}

export class UploadProofDto {
  @ApiPropertyOptional({ description: 'Financial year (defaults to the current one)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) fy?: number;
  @ApiProperty({ enum: TAX_PROOF_SECTIONS }) @IsIn(TAX_PROOF_SECTIONS) section!: TaxProofSection;
  @ApiProperty({ example: 'PPF deposit, SBI' }) @Transform(trim) @IsString() @Length(3, 200) description!: string;
  @ApiProperty({ example: 50000 }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(MAX_AMOUNT) amount!: number;
}

export class ProofQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) fy?: number;
  @ApiPropertyOptional({ enum: TAX_PROOF_STATUSES }) @IsOptional() @IsIn(TAX_PROOF_STATUSES) status?: TaxProofStatus;
}

export class AcceptProofDto {
  @ApiPropertyOptional({ description: 'Accepted amount (defaults to the amount claimed)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  amount?: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class RejectProofDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class Tds24qQueryDto {
  @ApiProperty({ example: 2026 }) @Type(() => Number) @IsInt() @Min(2000) @Max(2100) fy!: number;
  @ApiProperty({ enum: ['Q1', 'Q2', 'Q3', 'Q4'] }) @IsIn(['Q1', 'Q2', 'Q3', 'Q4']) quarter!: 'Q1' | 'Q2' | 'Q3' | 'Q4';
}

export class TaxDeclarationDto {
  @ApiProperty({ enum: TAX_REGIMES }) @IsIn(TAX_REGIMES) regime!: TaxRegime;
  @ApiPropertyOptional({ description: 'Rent paid in the year (old regime HRA exemption)' }) @Amount() rentPaidAnnual?: number;
  @ApiPropertyOptional({ description: 'Rented home in Delhi, Mumbai, Kolkata or Chennai' }) @IsOptional() @IsBoolean() metroCity?: boolean;
  @ApiPropertyOptional({ description: 'Section 80C investments besides employee PF' }) @Amount() section80c?: number;
  @ApiPropertyOptional({ description: 'Section 80CCD(1B) – own NPS contribution' }) @Amount() section80ccd1b?: number;
  @ApiPropertyOptional({ description: 'Section 80D – health insurance premiums' }) @Amount() section80d?: number;
  @ApiPropertyOptional({ description: 'Section 24(b) – interest on a home loan (self-occupied)' }) @Amount() homeLoanInterest?: number;
  @ApiPropertyOptional({ description: 'Taxable salary from an earlier employer this year' }) @Amount() previousEmployerIncome?: number;
  @ApiPropertyOptional({ description: 'Tax deducted by that employer' }) @Amount() previousEmployerTds?: number;
}

// ---- Runs --------------------------------------------------------------------------------------

export class CreateRunDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @ApiPropertyOptional({ nullable: true, description: 'Run for a pay group; empty = the main run (everyone without a pay group)' }) @Transform(emptyToNull) @optionalNullable @IsUUID() payGroupId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) notes?: string | null;
}

export class RunQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
  @ApiPropertyOptional({ enum: PAYROLL_RUN_STATUSES }) @IsOptional() @IsIn(PAYROLL_RUN_STATUSES) status?: PayrollRunStatus;
}

export class PayGroupDto {
  @ApiProperty({ example: 'Contractors' }) @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'The legal entity that pays this group (its currency and statutory rules)' }) @optionalNullable @IsUUID() legalEntityId?: string | null;
}
export class UpdatePayGroupDto extends PartialType(PayGroupDto) {}

export class AssignPayGroupDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) employeeIds!: string[];
  @ApiPropertyOptional({ nullable: true, description: 'null = back to the main run' }) @Transform(emptyToNull) @optionalNullable @IsUUID() payGroupId?: string | null;
}

export class BonusPayoutDto {
  @ApiProperty({ example: 'Diwali bonus' }) @Transform(trim) @IsString() @Length(2, 100) label!: string;
  @ApiProperty({ enum: ['BONUS', 'INCENTIVE'] }) @IsIn(['BONUS', 'INCENTIVE']) category!: 'BONUS' | 'INCENTIVE';
  @ApiProperty({ enum: BONUS_BASES, description: 'FIXED = the same amount each; PERCENT_OF_* = % of the monthly Basic or gross; STATUTORY = Payment of Bonus Act' })
  @IsIn(BONUS_BASES)
  basis!: BonusBasis;
  @ApiProperty({ description: 'Amount (FIXED) or percentage (others; 8.33–20 for STATUTORY)' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(MAX_AMOUNT) value!: number;
  @ApiPropertyOptional({ type: [String], description: 'Only these employees (default: everyone in the run)' }) @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID('all', { each: true }) employeeIds?: string[];
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() taxable?: boolean;
}

export class BankFileQueryDto {
  @ApiPropertyOptional({ enum: BANK_FILE_FORMATS, default: 'GENERIC' }) @IsOptional() @IsIn(BANK_FILE_FORMATS) format?: BankFileFormat;
}

export class RunPayslipQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['warnings', 'held'] }) @IsOptional() @IsIn(['warnings', 'held']) filter?: 'warnings' | 'held';
}

export class ReviewRunDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

export class RejectRunDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class PayRunDto {
  @ApiProperty({ example: 'NEFT batch 2026-11-30' }) @Transform(trim) @IsString() @Length(2, 100) paymentReference!: string;
}

export class UpdatePayslipDto {
  @ApiPropertyOptional({ nullable: true, description: 'Loss-of-pay days replacing the attendance figure (half days allowed); null = from attendance' })
  @optionalNullable
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(31)
  lopOverride?: number | null;
  @ApiPropertyOptional({ description: 'Hold: leave the employee out of this run' }) @IsOptional() @IsBoolean() excluded?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(300) excludeReason?: string | null;
}

export class AdjustmentDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty({ enum: ['EARNING', 'DEDUCTION'] }) @IsIn(['EARNING', 'DEDUCTION']) kind!: 'EARNING' | 'DEDUCTION';
  @ApiProperty({ example: 'Performance bonus' }) @Transform(trim) @IsString() @Length(2, 100) label!: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(MAX_AMOUNT) amount!: number;
  @ApiPropertyOptional({ default: true, description: 'Earnings only: counts as taxable salary' }) @IsOptional() @IsBoolean() taxable?: boolean;
  @ApiPropertyOptional({ enum: ADJUSTMENT_CATEGORIES, default: 'OTHER' }) @IsOptional() @IsIn(ADJUSTMENT_CATEGORIES) category?: AdjustmentCategory;
}

// ---- Reimbursements ------------------------------------------------------------------------------

/** Multipart form fields (values arrive as strings). */
export class ClaimDto {
  @ApiProperty({ enum: REIMBURSEMENT_CATEGORIES }) @IsIn(REIMBURSEMENT_CATEGORIES) category!: ReimbursementCategory;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 150) title!: string;
  @ApiProperty({ example: '2026-11-03' }) @IsISO8601(DATE) expenseDate!: string;
  @ApiProperty({ description: 'In `currency` when given, else in your pay currency' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) amount!: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'USD', description: "The receipt's currency, when not your pay currency (converted at the rate on the expense date)" })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null))
  @optionalNullable
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency?: string | null;
}

export class ExpensePolicyRuleDto {
  @ApiProperty({ enum: REIMBURSEMENT_CATEGORIES }) @IsIn(REIMBURSEMENT_CATEGORIES) category!: ReimbursementCategory;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() allowed?: boolean;
  @ApiPropertyOptional({ nullable: true }) @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) perClaimLimit?: number | null;
  @ApiPropertyOptional({ nullable: true }) @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100_000_000) monthlyLimit?: number | null;
  @ApiPropertyOptional({ nullable: true, description: '0 = always; null = never' })
  @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) receiptRequiredAbove?: number | null;
}

export class ExpensePolicyDto {
  @ApiProperty({ type: [ExpensePolicyRuleDto] }) @IsArray() @ArrayMaxSize(REIMBURSEMENT_CATEGORIES.length) @ValidateNested({ each: true }) @Type(() => ExpensePolicyRuleDto) categories!: ExpensePolicyRuleDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Claims above this amount also need a finance approval (null = one approval)' })
  @Transform(({ value }) => (value === '' ? null : value)) @optionalNullable @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) financeApprovalAbove?: number | null;
}

export class ClaimQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'approve', 'finance', 'all'], default: 'mine', description: 'approve = waiting on you as manager; finance = waiting on the finance approval' })
  @IsOptional() @IsIn(['mine', 'approve', 'finance', 'all']) view?: 'mine' | 'approve' | 'finance' | 'all';
  @ApiPropertyOptional({ enum: REIMBURSEMENT_STATUSES }) @IsOptional() @IsIn(REIMBURSEMENT_STATUSES) status?: ReimbursementStatus;
}

export class ReviewClaimDto {
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(500) note?: string | null;
}

// ---- Loans & salary advances ---------------------------------------------------------------------

export class LoanRequestDto {
  @ApiProperty({ enum: LOAN_TYPES }) @IsIn(LOAN_TYPES) type!: LoanType;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1000) @Max(LOAN_MAX_PRINCIPAL) amount!: number;
  @ApiProperty({ description: `Months to repay (advances: up to ${ADVANCE_MAX_TENURE_MONTHS})` }) @Type(() => Number) @IsInt() @Min(1) @Max(LOAN_MAX_TENURE_MONTHS) tenureMonths!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) purpose!: string;
}

/** Raised by payroll on an employee's behalf; still approved by someone else. */
export class CreateLoanDto extends LoanRequestDto {
  @ApiProperty() @IsUUID() employeeId!: string;
}

export class ApproveLoanDto {
  @ApiPropertyOptional({ description: 'Approve a smaller amount than requested' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1000)
  @Max(LOAN_MAX_PRINCIPAL)
  amount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(LOAN_MAX_TENURE_MONTHS) tenureMonths?: number;
  @ApiPropertyOptional({ description: 'Yearly interest on the reducing balance (loans only)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(LOAN_MAX_INTEREST_RATE)
  interestRate?: number;
  @ApiProperty({ description: 'First month payroll deducts the instalment' }) @Type(() => Number) @IsInt() @Min(2000) @Max(2100) startYear!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(12) startMonth!: number;
  @ApiPropertyOptional({ nullable: true }) @Transform(emptyToNull) @optionalNullable @IsString() @MaxLength(1000) note?: string | null;
}

export class RejectLoanDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) note!: string;
}

export class DisburseLoanDto {
  @ApiProperty() @IsISO8601(DATE) disbursedOn!: string;
  @ApiProperty({ description: 'Bank transfer reference' }) @Transform(trim) @IsString() @Length(2, 120) reference!: string;
}

export class DeferLoanDto {
  @ApiProperty({ description: 'Next month payroll deducts the instalment' }) @Type(() => Number) @IsInt() @Min(2000) @Max(2100) startYear!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(12) startMonth!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class LoanRepaymentDto {
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(LOAN_MAX_PRINCIPAL) amount!: number;
  @ApiProperty() @IsISO8601(DATE) paidOn!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) note!: string;
}

export class LoanQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['approve', 'all'], default: 'all', description: 'approve = requests waiting for me' }) @IsOptional() @IsIn(['approve', 'all']) view?: 'approve' | 'all';
  @ApiPropertyOptional({ enum: [...LOAN_STATUSES, 'OPEN'] }) @IsOptional() @IsIn([...LOAN_STATUSES, 'OPEN']) status?: LoanStatus | 'OPEN';
  @ApiPropertyOptional({ enum: LOAN_TYPES }) @IsOptional() @IsIn(LOAN_TYPES) type?: LoanType;
}
