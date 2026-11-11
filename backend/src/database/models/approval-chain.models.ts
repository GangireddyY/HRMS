import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { AllowNull, Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { ApprovalChainConditions, ApprovalChainStep, ApprovalInstanceStatus, ApprovalSubject } from '../../contracts';

@Table({ tableName: 'approval_chains', underscored: true })
export class ApprovalChain extends Model<InferAttributes<ApprovalChain>, InferCreationAttributes<ApprovalChain>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(12)) subject: ApprovalSubject;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.SMALLINT) priority: CreationOptional<number>;
  @Column(DataType.JSONB) conditions: CreationOptional<ApprovalChainConditions>;
  @Column(DataType.JSONB) steps: ApprovalChainStep[];
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

export interface InstanceStep {
  label: string;
  approverMembershipIds: string[];
  /** Added when the step's deadline passed. */
  escalatedMembershipIds: string[];
  slaHours: number | null;
}

export interface InstanceDecision {
  step: number;
  membershipId: string;
  name: string;
  decision: 'APPROVED' | 'REJECTED';
  note: string | null;
  at: string;
  /** Decided under approval cover for this approver. */
  onBehalfOf: string | null;
}

@Table({ tableName: 'approval_instances', underscored: true })
export class ApprovalInstance extends Model<InferAttributes<ApprovalInstance>, InferCreationAttributes<ApprovalInstance>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(12)) subject: ApprovalSubject;
  @Column(DataType.UUID) subjectId: string;
  @Column(DataType.UUID) chainId: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) chainName: string;
  @Column(DataType.UUID) requesterMembershipId: CreationOptional<string | null>;
  @Column(DataType.JSONB) steps: InstanceStep[];
  @Column(DataType.SMALLINT) currentStep: CreationOptional<number>;
  @Column(DataType.STRING(10)) status: CreationOptional<ApprovalInstanceStatus>;
  @Column(DataType.DATE) stepStartedAt: CreationOptional<Date>;
  @Column(DataType.DATE) dueAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) escalatedAt: CreationOptional<Date | null>;
  @Column(DataType.JSONB) decisions: CreationOptional<InstanceDecision[]>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}
