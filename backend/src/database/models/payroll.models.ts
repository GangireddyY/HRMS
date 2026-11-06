import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { ComponentCalculation, PayrollRunStatus, ReimbursementCategory, ReimbursementStatus, TaxRegime } from '../../contracts';
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

@Table({ tableName: 'payroll_runs', underscored: true })
export class PayrollRun extends Model<InferAttributes<PayrollRun>, InferCreationAttributes<PayrollRun>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.SMALLINT) year: number;
  @Column(DataType.SMALLINT) month: number;
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
  @CreatedAt createdAt: CreationOptional<Date>;
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
  @Column(DataType.DECIMAL(12, 2)) amount: string;
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
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => PayrollRun, 'payrollRunId') run?: NonAttribute<PayrollRun | null>;
}
