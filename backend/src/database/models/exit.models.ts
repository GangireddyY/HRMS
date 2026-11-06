import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { ClearanceDepartment, ClearanceStatus, DailyRateBasis, ExitReason, ExitStatus, ExitType, SettlementStatus } from '../../contracts';
import { Employee } from './people.models';

export interface ExitFeedback {
  submittedAt: string;
  wouldRecommend: number;
  wouldRejoin: boolean;
  liked: string | null;
  improve: string | null;
}

export interface SettlementLine {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
  detail: string | null;
}

export interface SettlementAdjustment {
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
}

@Table({ tableName: 'exit_cases', underscored: true })
export class ExitCase extends Model<InferAttributes<ExitCase>, InferCreationAttributes<ExitCase>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(14)) type: ExitType;
  @Column(DataType.STRING(20)) reason: ExitReason;
  @Column(DataType.STRING(2000)) reasonDetail: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: ExitStatus;
  @Column(DataType.DATEONLY) submittedOn: string;
  @Column(DataType.INTEGER) noticeDays: number;
  @Column(DataType.DATEONLY) noticeEndsOn: string;
  @Column(DataType.DATEONLY) requestedLastDay: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) lastWorkingDay: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) noticeWaived: CreationOptional<boolean>;
  @Column(DataType.UUID) decidedById: CreationOptional<string | null>;
  @Column(DataType.DATE) decidedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(1000)) decisionNote: CreationOptional<string | null>;
  @Column(DataType.DATE) completedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) completedById: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) closedReason: CreationOptional<string | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @Column(DataType.JSONB) feedback: CreationOptional<ExitFeedback | null>;
  @Column(DataType.BOOLEAN) eligibleForRehire: CreationOptional<boolean | null>;
  @Column(DataType.STRING(1000)) rehireNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @HasMany(() => ExitClearanceItem, 'caseId') clearance?: NonAttribute<ExitClearanceItem[]>;
}

@Table({ tableName: 'exit_clearance_items', underscored: true })
export class ExitClearanceItem extends Model<InferAttributes<ExitClearanceItem>, InferCreationAttributes<ExitClearanceItem>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => ExitCase) @Column(DataType.UUID) caseId: string;
  @Column(DataType.STRING(10)) department: ClearanceDepartment;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(16)) status: CreationOptional<ClearanceStatus>;
  @Column(DataType.DECIMAL(12, 2)) recoveryAmount: CreationOptional<string>;
  @Column(DataType.STRING(1000)) note: CreationOptional<string | null>;
  @Column(DataType.INTEGER) sortOrder: CreationOptional<number>;
  @Column(DataType.UUID) clearedById: CreationOptional<string | null>;
  @Column(DataType.DATE) clearedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'exit_settlements', underscored: true })
export class ExitSettlement extends Model<InferAttributes<ExitSettlement>, InferCreationAttributes<ExitSettlement>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => ExitCase) @Column(DataType.UUID) caseId: string;
  @Column(DataType.STRING(10)) status: CreationOptional<SettlementStatus>;
  @Column(DataType.STRING(10)) encashmentBasis: DailyRateBasis;
  @Column(DataType.STRING(10)) noticeBasis: DailyRateBasis;
  @Column(DataType.BOOLEAN) includeGratuity: boolean;
  @Column(DataType.STRING(1000)) gratuityNote: CreationOptional<string | null>;
  @Column(DataType.JSONB) adjustments: CreationOptional<SettlementAdjustment[]>;
  @Column(DataType.JSONB) lines: CreationOptional<SettlementLine[]>;
  @Column(DataType.JSONB) inputs: CreationOptional<Record<string, unknown>>;
  @Column(DataType.DECIMAL(14, 2)) totalEarnings: CreationOptional<string>;
  @Column(DataType.DECIMAL(14, 2)) totalDeductions: CreationOptional<string>;
  @Column(DataType.DECIMAL(14, 2)) netPayable: CreationOptional<string>;
  @Column(DataType.DATEONLY) dueOn: string;
  @Column(DataType.UUID) calculatedById: CreationOptional<string | null>;
  @Column(DataType.DATE) calculatedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) submittedById: CreationOptional<string | null>;
  @Column(DataType.DATE) submittedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) approvedById: CreationOptional<string | null>;
  @Column(DataType.DATE) approvedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(1000)) returnedNote: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) paidOn: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) paymentReference: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}
