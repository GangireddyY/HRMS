import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { AccrualFrequency, ApprovalStep, CompOffDayKind, EmploymentType, LeaveEncashmentStatus, LeaveGender, LeaveRequestStatus, LeaveSession, LedgerKind } from '../../contracts';
import { Employee } from './people.models';

/** A kind of leave and its policy. Decimal columns come back from PostgreSQL as strings. */
@Table({ tableName: 'leave_types', underscored: true })
export class LeaveType extends Model<InferAttributes<LeaveType>, InferCreationAttributes<LeaveType>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(10)) code: string;
  @Column(DataType.STRING(80)) name: string;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.CHAR(7)) color: CreationOptional<string>;
  @Column(DataType.BOOLEAN) isPaid: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) unlimited: CreationOptional<boolean>;
  @Column(DataType.DECIMAL(5, 2)) annualQuota: CreationOptional<string>;
  @Column(DataType.STRING(10)) accrualFrequency: CreationOptional<AccrualFrequency>;
  @Column(DataType.BOOLEAN) prorateOnJoining: CreationOptional<boolean>;
  @Column(DataType.DECIMAL(5, 2)) carryForwardLimit: CreationOptional<string>;
  @Column(DataType.BOOLEAN) encashable: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) allowHalfDay: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) allowNegativeBalance: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) countNonWorkingDays: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) minNoticeDays: CreationOptional<number>;
  @Column(DataType.SMALLINT) maxBackdatedDays: CreationOptional<number>;
  @Column(DataType.SMALLINT) maxConsecutiveDays: CreationOptional<number | null>;
  @Column(DataType.SMALLINT) eligibleAfterDays: CreationOptional<number>;
  @Column(DataType.STRING(10)) applicableGender: CreationOptional<LeaveGender | null>;
  /** Set on the organization's comp-off type: days credited for working on a day off expire after this many days. */
  @Column(DataType.SMALLINT) compOffValidityDays: CreationOptional<number | null>;
  /** 2 = the manager approves, then HR; `secondApprovalMinDays` limits the second level to longer requests. */
  @Column(DataType.SMALLINT) approvalLevels: CreationOptional<number>;
  @Column(DataType.DECIMAL(5, 1)) secondApprovalMinDays: CreationOptional<string | null>;
  /** Who the type applies to besides gender: null = every location / employment type / grade. */
  @Column(DataType.ARRAY(DataType.UUID)) locationIds: CreationOptional<string[] | null>;
  @Column(DataType.ARRAY(DataType.STRING(20))) employmentTypes: CreationOptional<EmploymentType[] | null>;
  @Column(DataType.ARRAY(DataType.UUID)) gradeIds: CreationOptional<string[] | null>;
  /** Accrual stops once the balance reaches this many days. */
  @Column(DataType.DECIMAL(6, 2)) maxBalance: CreationOptional<string | null>;
  /** Encashment limits (encashable types): days per leave year, and the balance that must stay. */
  @Column(DataType.DECIMAL(5, 1)) encashMaxDays: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(5, 1)) encashMinBalance: CreationOptional<string>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** A request to be paid for unused leave; once approved it leaves the balance and is paid by the next payroll run. */
@Table({ tableName: 'leave_encashments', underscored: true })
export class LeaveEncashment extends Model<InferAttributes<LeaveEncashment>, InferCreationAttributes<LeaveEncashment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => LeaveType) @Column(DataType.UUID) leaveTypeId: string;
  @Column(DataType.SMALLINT) leaveYear: number;
  @Column(DataType.DECIMAL(5, 1)) days: string;
  @Column(DataType.STRING(500)) reason: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<LeaveEncashmentStatus>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.UUID) payrollRunId: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(12, 2)) amount: CreationOptional<string | null>;
  @Column(DataType.DATE) paidAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => LeaveType, 'leaveTypeId') leaveType?: NonAttribute<LeaveType>;
}

@Table({ tableName: 'leave_requests', underscored: true })
export class LeaveRequest extends Model<InferAttributes<LeaveRequest>, InferCreationAttributes<LeaveRequest>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => LeaveType) @Column(DataType.UUID) leaveTypeId: string;
  @Column(DataType.SMALLINT) leaveYear: number;
  @Column(DataType.DATEONLY) startDate: string;
  @Column(DataType.DATEONLY) endDate: string;
  @Column(DataType.STRING(12)) startSession: CreationOptional<LeaveSession>;
  @Column(DataType.STRING(12)) endSession: CreationOptional<LeaveSession>;
  @Column(DataType.DECIMAL(5, 1)) days: string;
  @Column(DataType.STRING(500)) reason: string;
  @Column(DataType.STRING(12)) status: CreationOptional<LeaveRequestStatus>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @Column(DataType.UUID) cancelledById: CreationOptional<string | null>;
  @Column(DataType.DATE) cancelledAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) cancelReason: CreationOptional<string | null>;
  /** The level waiting for a decision (1-based) out of `approvalLevels`, fixed when the request is made. */
  @Column(DataType.SMALLINT) approvalLevel: CreationOptional<number>;
  @Column(DataType.SMALLINT) approvalLevels: CreationOptional<number>;
  @Column(DataType.JSONB) approvalTrail: CreationOptional<ApprovalStep[]>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => LeaveType, 'leaveTypeId') leaveType?: NonAttribute<LeaveType>;
}

/** Append-only balance ledger (enforced by a database trigger). */
@Table({ tableName: 'leave_ledger_entries', underscored: true, updatedAt: false })
export class LeaveLedgerEntry extends Model<InferAttributes<LeaveLedgerEntry>, InferCreationAttributes<LeaveLedgerEntry>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => LeaveType) @Column(DataType.UUID) leaveTypeId: string;
  @Column(DataType.SMALLINT) leaveYear: number;
  @Column(DataType.STRING(16)) kind: LedgerKind;
  @Column(DataType.DECIMAL(6, 2)) days: string;
  @Column(DataType.DATEONLY) effectiveDate: string;
  @ForeignKey(() => LeaveRequest) @Column(DataType.UUID) leaveRequestId: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) idempotencyKey: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => LeaveType, 'leaveTypeId') leaveType?: NonAttribute<LeaveType>;
  @BelongsTo(() => LeaveRequest, 'leaveRequestId') leaveRequest?: NonAttribute<LeaveRequest | null>;
}

/** A request to be credited compensatory off for working on a holiday or weekly off. */
@Table({ tableName: 'comp_off_requests', underscored: true })
export class CompOffRequest extends Model<InferAttributes<CompOffRequest>, InferCreationAttributes<CompOffRequest>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATEONLY) workDate: string;
  @Column(DataType.STRING(12)) dayKind: CompOffDayKind;
  @Column(DataType.STRING(120)) dayLabel: CreationOptional<string | null>;
  @Column(DataType.INTEGER) workedMinutes: number;
  @Column(DataType.DECIMAL(2, 1)) days: string;
  @Column(DataType.STRING(500)) reason: string;
  @Column(DataType.STRING(12)) status: CreationOptional<LeaveRequestStatus>;
  @ForeignKey(() => LeaveType) @Column(DataType.UUID) leaveTypeId: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) expiresOn: CreationOptional<string | null>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}
