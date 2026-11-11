import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { AdjustmentCategory, ClaimApprovalStep, ComponentCalculation, DailyRateBasis, PayslipPdfPassword, LoanRepaymentSource, LoanStatus, LoanType, PayrollRunStatus, ReimbursementCategory, ReimbursementStatus, TaxProofSection, TaxProofStatus, TaxRegime, TimesheetMissedAction } from '../../contracts';
import { Employee } from './people.models';

/** Decimal columns come back from PostgreSQL as strings. */

@Table({ tableName: 'payroll_settings', underscored: true })
export class PayrollSettings extends Model<InferAttributes<PayrollSettings>, InferCreationAttributes<PayrollSettings>> {
  @PrimaryKey @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.BOOLEAN) pfEnabled: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) pfRestrictToCeiling: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) esiEnabled: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) ptEnabled: CreationOptional<boolean>;
  @Column(DataType.STRING(2)) ptState: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) lopFromAttendance: CreationOptional<boolean>;
  @Column(DataType.STRING(30)) pfEstablishmentCode: CreationOptional<string | null>;
  @Column(DataType.STRING(30)) esiEmployerCode: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) tan: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(3, 1)) overtimeMultiplier: CreationOptional<string>;
  @Column(DataType.STRING(5)) overtimeBasis: CreationOptional<'BASIC' | 'GROSS'>;
  @Column(DataType.BOOLEAN) timesheetsRequired: CreationOptional<boolean>;
  /** Monday of the first week that needs a timesheet (set when the rule is switched on). */
  @Column(DataType.DATEONLY) timesheetsFrom: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) timesheetDueWeekday: CreationOptional<number>;
  @Column(DataType.STRING(4)) timesheetMissedAction: CreationOptional<TimesheetMissedAction>;
  /** Remind people automatically on the due day and the day after. */
  @Column(DataType.BOOLEAN) timesheetAutoRemind: CreationOptional<boolean>;
  /** Monday of the last week reminded on its due day / the day after (written by the reminder job only). */
  @Column(DataType.DATEONLY) timesheetDueReminded: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) timesheetOverdueReminded: CreationOptional<string | null>;
  /** Raises above this percent need a second person's approval; null = no approval step. */
  @Column(DataType.DECIMAL(5, 2)) salaryApprovalThresholdPct: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) lwfEnabled: CreationOptional<boolean>;
  /** Calendar month from which income tax uses accepted proofs only; null = declarations all year. */
  @Column(DataType.SMALLINT) proofsFromMonth: CreationOptional<number | null>;
  /** Daily rate for leave encashed while in service (paid through payroll). */
  @Column(DataType.STRING(10)) leaveEncashmentBasis: CreationOptional<DailyRateBasis>;
  /** Email each employee their payslip PDF when a run is approved; the PDF password rule. */
  @Column(DataType.BOOLEAN) payslipEmailEnabled: CreationOptional<boolean>;
  @Column(DataType.STRING(10)) payslipPdfPassword: CreationOptional<PayslipPdfPassword>;
  /** Reimbursement claims above this amount need a finance approval after the manager's; null = one approval. */
  @Column(DataType.DECIMAL(12, 2)) claimFinanceApprovalAbove: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'salary_components', underscored: true })
export class SalaryComponentDef extends Model<InferAttributes<SalaryComponentDef>, InferCreationAttributes<SalaryComponentDef>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) code: string;
  @Column(DataType.STRING(100)) name: string;
  @Column(DataType.STRING(300)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) role: CreationOptional<'BASIC' | 'HRA' | null>;
  @Column(DataType.BOOLEAN) taxable: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) pfWage: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) esiWage: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'salary_structures', underscored: true })
export class SalaryStructure extends Model<InferAttributes<SalaryStructure>, InferCreationAttributes<SalaryStructure>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(100)) name: string;
  @Column(DataType.STRING(300)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @HasMany(() => SalaryStructureLine, 'structureId') lines?: NonAttribute<SalaryStructureLine[]>;
}

@Table({ tableName: 'salary_structure_lines', underscored: true, timestamps: false })
export class SalaryStructureLine extends Model<InferAttributes<SalaryStructureLine>, InferCreationAttributes<SalaryStructureLine>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => SalaryStructure) @Column(DataType.UUID) structureId: string;
  @ForeignKey(() => SalaryComponentDef) @Column(DataType.UUID) componentId: string;
  @Column(DataType.STRING(20)) calculation: ComponentCalculation;
  @Column(DataType.DECIMAL(12, 2)) value: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;

  @BelongsTo(() => SalaryComponentDef, 'componentId') component?: NonAttribute<SalaryComponentDef>;
}

/** A salary from `effectiveFrom` until the next one (history); the breakdown is a snapshot taken when it was set. */
@Table({ tableName: 'employee_salaries', underscored: true, updatedAt: false })
export class EmployeeSalary extends Model<InferAttributes<EmployeeSalary>, InferCreationAttributes<EmployeeSalary>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => SalaryStructure) @Column(DataType.UUID) structureId: string;
  @Column(DataType.DECIMAL(14, 2)) annualCtc: string;
  @Column(DataType.DATEONLY) effectiveFrom: string;
  @Column(DataType.BOOLEAN) pfApplicable: CreationOptional<boolean>;
  @Column(DataType.DECIMAL(12, 2)) monthlyGross: string;
  @Column(DataType.DECIMAL(12, 2)) employerPf: string;
  @Column(DataType.DECIMAL(12, 2)) employerEsi: string;
  @Column(DataType.JSONB) components: unknown;
  @Column(DataType.STRING(300)) reason: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => SalaryStructure, 'structureId') structure?: NonAttribute<SalaryStructure>;
}

export type SalaryRevisionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** A raise above the approval threshold, waiting for a second person before it becomes an EmployeeSalary. */
@Table({ tableName: 'salary_revision_requests', underscored: true })
export class SalaryRevisionRequest extends Model<InferAttributes<SalaryRevisionRequest>, InferCreationAttributes<SalaryRevisionRequest>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => SalaryStructure) @Column(DataType.UUID) structureId: string;
  @Column(DataType.DECIMAL(14, 2)) annualCtc: string;
  @Column(DataType.DECIMAL(14, 2)) previousCtc: string;
  @Column(DataType.DATEONLY) effectiveFrom: string;
  @Column(DataType.BOOLEAN) pfApplicable: CreationOptional<boolean>;
  @Column(DataType.STRING(300)) reason: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<SalaryRevisionStatus>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.UUID) salaryId: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => SalaryStructure, 'structureId') structure?: NonAttribute<SalaryStructure>;
}

@Table({ tableName: 'tax_declarations', underscored: true })
export class TaxDeclarationRecord extends Model<InferAttributes<TaxDeclarationRecord>, InferCreationAttributes<TaxDeclarationRecord>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.SMALLINT) financialYear: number;
  @Column(DataType.STRING(3)) regime: CreationOptional<TaxRegime>;
  @Column(DataType.DECIMAL(12, 2)) rentPaidAnnual: CreationOptional<string>;
  @Column(DataType.BOOLEAN) metroCity: CreationOptional<boolean>;
  @Column({ type: DataType.DECIMAL(12, 2), field: 'section_80c' }) section80c: CreationOptional<string>;
  @Column({ type: DataType.DECIMAL(12, 2), field: 'section_80ccd1b' }) section80ccd1b: CreationOptional<string>;
  @Column({ type: DataType.DECIMAL(12, 2), field: 'section_80d' }) section80d: CreationOptional<string>;
  @Column(DataType.DECIMAL(12, 2)) homeLoanInterest: CreationOptional<string>;
  @Column(DataType.DECIMAL(14, 2)) previousEmployerIncome: CreationOptional<string>;
  @Column(DataType.DECIMAL(12, 2)) previousEmployerTds: CreationOptional<string>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** A proof for a declared deduction; once accepted, `acceptedAmount` is what income tax may use. */
@Table({ tableName: 'tax_declaration_proofs', underscored: true })
export class TaxDeclarationProof extends Model<InferAttributes<TaxDeclarationProof>, InferCreationAttributes<TaxDeclarationProof>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.SMALLINT) financialYear: number;
  @Column(DataType.STRING(12)) section: TaxProofSection;
  @Column(DataType.STRING(200)) description: string;
  @Column(DataType.DECIMAL(12, 2)) amount: string;
  @Column(DataType.STRING(300)) storageKey: string;
  @Column(DataType.STRING(200)) fileName: string;
  @Column(DataType.STRING(100)) contentType: string;
  @Column(DataType.INTEGER) byteSize: number;
  @Column(DataType.STRING(10)) status: CreationOptional<TaxProofStatus>;
  @Column(DataType.DECIMAL(12, 2)) acceptedAmount: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) uploadedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

@Table({ tableName: 'payroll_runs', underscored: true })
export class PayrollRun extends Model<InferAttributes<PayrollRun>, InferCreationAttributes<PayrollRun>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.SMALLINT) year: number;
  @Column(DataType.SMALLINT) month: number;
  /** null = the main run (employees without a pay group). */
  @Column(DataType.UUID) payGroupId: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<PayrollRunStatus>;
  @Column(DataType.STRING(500)) notes: CreationOptional<string | null>;
  @Column(DataType.INTEGER) employeeCount: CreationOptional<number>;
  @Column(DataType.DECIMAL(14, 2)) totalGross: CreationOptional<string>;
  @Column(DataType.DECIMAL(14, 2)) totalDeductions: CreationOptional<string>;
  @Column(DataType.DECIMAL(14, 2)) totalNet: CreationOptional<string>;
  @Column(DataType.DECIMAL(14, 2)) totalEmployerContributions: CreationOptional<string>;
  @Column(DataType.INTEGER) warningCount: CreationOptional<number>;
  @Column(DataType.DATE) calculatedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) calculatedById: CreationOptional<string | null>;
  @Column(DataType.DATE) submittedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) submittedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.DATE) paidAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) paidById: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) paymentReference: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @HasMany(() => Payslip, 'runId') payslips?: NonAttribute<Payslip[]>;
}

export interface PayslipLine {
  code: string;
  name: string;
  amount: number;
  /** Earnings: monthly amount at full attendance. */
  rate?: number;
  taxable?: boolean;
}

@Table({ tableName: 'payslips', underscored: true })
export class Payslip extends Model<InferAttributes<Payslip>, InferCreationAttributes<Payslip>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PayrollRun) @Column(DataType.UUID) runId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.JSONB) employee: Record<string, unknown>;
  /** The paying entity's currency; null = the organization's. */
  @Column(DataType.CHAR(3)) currency: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) daysInMonth: number;
  @Column(DataType.DECIMAL(4, 1)) employedDays: string;
  @Column(DataType.DECIMAL(4, 1)) lopDays: CreationOptional<string>;
  @Column(DataType.DECIMAL(4, 1)) lopOverride: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(4, 1)) payableDays: string;
  @Column(DataType.JSONB) earnings: PayslipLine[];
  @Column(DataType.JSONB) deductions: PayslipLine[];
  @Column(DataType.JSONB) employerContributions: PayslipLine[];
  @Column(DataType.DECIMAL(12, 2)) gross: string;
  @Column(DataType.DECIMAL(12, 2)) totalDeductions: string;
  @Column(DataType.DECIMAL(12, 2)) netPay: string;
  @Column(DataType.JSONB) statutory: Record<string, unknown>;
  @Column(DataType.JSONB) tax: CreationOptional<Record<string, unknown> | null>;
  @Column(DataType.JSONB) warnings: CreationOptional<string[]>;
  @Column(DataType.BOOLEAN) excluded: CreationOptional<boolean>;
  @Column(DataType.STRING(300)) excludeReason: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => PayrollRun, 'runId') run?: NonAttribute<PayrollRun>;
  @BelongsTo(() => Employee, 'employeeId') employeeRecord?: NonAttribute<Employee>;
}

@Table({ tableName: 'payroll_adjustments', underscored: true, updatedAt: false })
export class PayrollAdjustment extends Model<InferAttributes<PayrollAdjustment>, InferCreationAttributes<PayrollAdjustment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PayrollRun) @Column(DataType.UUID) runId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(10)) kind: 'EARNING' | 'DEDUCTION';
  @Column(DataType.STRING(100)) label: string;
  @Column(DataType.DECIMAL(12, 2)) amount: string;
  @Column(DataType.BOOLEAN) taxable: CreationOptional<boolean>;
  @Column(DataType.STRING(10)) category: CreationOptional<AdjustmentCategory>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

/** A group of employees paid in their own payroll runs (e.g. contractors, a subsidiary, weekly-paid staff). */
@Table({ tableName: 'pay_groups', underscored: true })
export class PayGroup extends Model<InferAttributes<PayGroup>, InferCreationAttributes<PayGroup>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(80)) name: string;
  @Column(DataType.STRING(300)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  /** The entity this group is paid by (its currency and statutory rules); null = the default entity. */
  @Column(DataType.UUID) legalEntityId: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

@Table({ tableName: 'reimbursement_claims', underscored: true })
export class ReimbursementClaim extends Model<InferAttributes<ReimbursementClaim>, InferCreationAttributes<ReimbursementClaim>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(20)) category: ReimbursementCategory;
  @Column(DataType.STRING(150)) title: string;
  @Column(DataType.DATEONLY) expenseDate: string;
  /** In the employee's pay currency (converted when the receipt was in another one). */
  @Column(DataType.DECIMAL(12, 2)) amount: string;
  /** The receipt's currency, when not the pay currency, with its amount and the rate used. */
  @Column(DataType.CHAR(3)) currency: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(12, 2)) originalAmount: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(18, 8)) exchangeRate: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(200)) receiptKey: CreationOptional<string | null>;
  @Column(DataType.STRING(255)) receiptName: CreationOptional<string | null>;
  @Column(DataType.STRING(50)) receiptType: CreationOptional<string | null>;
  @Column(DataType.INTEGER) receiptSize: CreationOptional<number | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<ReimbursementStatus>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @ForeignKey(() => PayrollRun) @Column(DataType.UUID) payrollRunId: CreationOptional<string | null>;
  /** While pending: waiting on the manager, or (above the finance threshold) on finance. */
  @Column(DataType.STRING(8)) approvalStage: CreationOptional<ClaimApprovalStep>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => PayrollRun, 'payrollRunId') run?: NonAttribute<PayrollRun | null>;
  @HasMany(() => ReimbursementApproval, 'claimId') approvals?: NonAttribute<ReimbursementApproval[]>;
}

@Table({ tableName: 'reimbursement_approvals', underscored: true, updatedAt: false })
export class ReimbursementApproval extends Model<InferAttributes<ReimbursementApproval>, InferCreationAttributes<ReimbursementApproval>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => ReimbursementClaim) @Column(DataType.UUID) claimId: string;
  @Column(DataType.STRING(8)) step: ClaimApprovalStep;
  @Column(DataType.STRING(8)) decision: 'APPROVED' | 'REJECTED';
  @Column(DataType.UUID) decidedById: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
}

/** Per category: whether it can be claimed, limits, and when a receipt is required. */
@Table({ tableName: 'expense_policies', underscored: true })
export class ExpensePolicy extends Model<InferAttributes<ExpensePolicy>, InferCreationAttributes<ExpensePolicy>> {
  @PrimaryKey @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @PrimaryKey @Column(DataType.STRING(20)) category: ReimbursementCategory;
  @Column(DataType.BOOLEAN) allowed: CreationOptional<boolean>;
  @Column(DataType.DECIMAL(12, 2)) perClaimLimit: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(12, 2)) monthlyLimit: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(12, 2)) receiptRequiredAbove: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'employee_loans', underscored: true })
export class EmployeeLoan extends Model<InferAttributes<EmployeeLoan>, InferCreationAttributes<EmployeeLoan>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(8)) type: LoanType;
  @Column(DataType.STRING(20)) reference: string;
  @Column(DataType.STRING(500)) purpose: string;
  @Column(DataType.DECIMAL(12, 2)) principal: string;
  @Column(DataType.DECIMAL(5, 2)) interestRate: CreationOptional<string>;
  @Column(DataType.SMALLINT) tenureMonths: number;
  @Column(DataType.DECIMAL(12, 2)) emi: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) startYear: CreationOptional<number | null>;
  @Column(DataType.SMALLINT) startMonth: CreationOptional<number | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<LoanStatus>;
  @Column(DataType.UUID) decidedById: CreationOptional<string | null>;
  @Column(DataType.DATE) decidedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(1000)) decisionNote: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) disbursedOn: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) disbursementReference: CreationOptional<string | null>;
  @Column(DataType.UUID) disbursedById: CreationOptional<string | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @HasMany(() => EmployeeLoanRepayment, 'loanId') repayments?: NonAttribute<EmployeeLoanRepayment[]>;
}

@Table({ tableName: 'employee_loan_repayments', underscored: true, updatedAt: false })
export class EmployeeLoanRepayment extends Model<InferAttributes<EmployeeLoanRepayment>, InferCreationAttributes<EmployeeLoanRepayment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => EmployeeLoan) @Column(DataType.UUID) loanId: string;
  @Column(DataType.STRING(10)) source: LoanRepaymentSource;
  @ForeignKey(() => PayrollRun) @Column(DataType.UUID) payrollRunId: CreationOptional<string | null>;
  @Column(DataType.UUID) settlementId: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) paidOn: string;
  @Column(DataType.DECIMAL(12, 2)) principal: string;
  @Column(DataType.DECIMAL(12, 2)) interest: CreationOptional<string>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => PayrollRun, 'payrollRunId') run?: NonAttribute<PayrollRun | null>;
}
