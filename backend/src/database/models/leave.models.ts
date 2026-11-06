import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { AccrualFrequency, LeaveGender, LeaveRequestStatus, LeaveSession, LedgerKind } from '../../contracts';
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
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
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
