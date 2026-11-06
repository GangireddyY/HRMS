import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { ComplianceCategory, EmploymentType, PolicyCategory, PolicyStatus, PolicyVersionStatus } from '../../contracts';
import { Employee } from './people.models';

@Table({ tableName: 'policies', underscored: true })
export class Policy extends Model<InferAttributes<Policy>, InferCreationAttributes<Policy>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(16)) category: PolicyCategory;
  @Column(DataType.STRING(1000)) summary: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<PolicyStatus>;
  @Column(DataType.UUID) ownerUserId: CreationOptional<string | null>;
  @Column(DataType.JSONB) departmentIds: CreationOptional<string[] | null>;
  @Column(DataType.JSONB) locationIds: CreationOptional<string[] | null>;
  @Column(DataType.JSONB) employmentTypes: CreationOptional<EmploymentType[] | null>;
  @Column(DataType.BOOLEAN) requiresAck: CreationOptional<boolean>;
  @Column(DataType.INTEGER) ackDueDays: CreationOptional<number>;
  @Column(DataType.INTEGER) reviewMonths: CreationOptional<number | null>;
  @Column(DataType.DATEONLY) nextReviewOn: CreationOptional<string | null>;
  @Column(DataType.UUID) currentVersionId: CreationOptional<string | null>;
  @Column(DataType.DATE) lastRemindedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @HasMany(() => PolicyVersion, 'policyId') versions?: NonAttribute<PolicyVersion[]>;
}

@Table({ tableName: 'policy_versions', underscored: true })
export class PolicyVersion extends Model<InferAttributes<PolicyVersion>, InferCreationAttributes<PolicyVersion>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Policy) @Column(DataType.UUID) policyId: string;
  @Column(DataType.INTEGER) version: number;
  @Column(DataType.STRING(10)) status: CreationOptional<PolicyVersionStatus>;
  @Column(DataType.TEXT) content: CreationOptional<string | null>;
  @Column(DataType.STRING(300)) fileKey: CreationOptional<string | null>;
  @Column(DataType.STRING(255)) fileName: CreationOptional<string | null>;
  @Column(DataType.INTEGER) fileSize: CreationOptional<number | null>;
  @Column(DataType.STRING(1000)) changeSummary: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) reacknowledge: CreationOptional<boolean>;
  @Column(DataType.DATEONLY) effectiveFrom: CreationOptional<string | null>;
  @Column(DataType.DATE) publishedAt: CreationOptional<Date | null>;
  @Column(DataType.DATEONLY) publishedOn: CreationOptional<string | null>;
  @Column(DataType.UUID) publishedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'policy_acknowledgements', underscored: true, timestamps: false })
export class PolicyAcknowledgement extends Model<InferAttributes<PolicyAcknowledgement>, InferCreationAttributes<PolicyAcknowledgement>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Policy) @Column(DataType.UUID) policyId: string;
  @ForeignKey(() => PolicyVersion) @Column(DataType.UUID) versionId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATE) acknowledgedAt: CreationOptional<Date>;
  @Column(DataType.STRING(64)) ipAddress: CreationOptional<string | null>;
  @Column(DataType.STRING(512)) userAgent: CreationOptional<string | null>;

  @BelongsTo(() => PolicyVersion, 'versionId') version?: NonAttribute<PolicyVersion>;
}

@Table({ tableName: 'compliance_obligations', underscored: true })
export class ComplianceObligation extends Model<InferAttributes<ComplianceObligation>, InferCreationAttributes<ComplianceObligation>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(10)) category: ComplianceCategory;
  @Column(DataType.STRING(150)) authority: CreationOptional<string | null>;
  @Column(DataType.STRING(2000)) description: CreationOptional<string | null>;
  @Column(DataType.JSONB) dueDates: string[];
  @Column(DataType.DATEONLY) startsOn: string;
  @Column(DataType.DATEONLY) endsOn: CreationOptional<string | null>;
  @Column(DataType.UUID) ownerUserId: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) active: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

@Table({ tableName: 'compliance_filings', underscored: true, updatedAt: false })
export class ComplianceFiling extends Model<InferAttributes<ComplianceFiling>, InferCreationAttributes<ComplianceFiling>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => ComplianceObligation) @Column(DataType.UUID) obligationId: string;
  @Column(DataType.DATEONLY) dueOn: string;
  @Column(DataType.DATEONLY) completedOn: string;
  @Column(DataType.STRING(120)) reference: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) note: CreationOptional<string | null>;
  @Column(DataType.STRING(300)) fileKey: CreationOptional<string | null>;
  @Column(DataType.STRING(255)) fileName: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) fileType: CreationOptional<string | null>;
  @Column(DataType.INTEGER) fileSize: CreationOptional<number | null>;
  @Column(DataType.UUID) completedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
}
