import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { BenefitPlanStatus, BenefitType, DependentRelation, EmploymentType, BenefitEnrollmentReason, BenefitEnrollmentStatus, Gender, LifeEvent } from '../../contracts';
import { Employee } from './people.models';

@Table({ tableName: 'benefit_plans', underscored: true })
export class BenefitPlan extends Model<InferAttributes<BenefitPlan>, InferCreationAttributes<BenefitPlan>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(150)) name: string;
  @Column(DataType.STRING(12)) type: BenefitType;
  @Column(DataType.STRING(150)) provider: CreationOptional<string | null>;
  @Column(DataType.STRING(80)) policyNumber: CreationOptional<string | null>;
  @Column(DataType.STRING(4000)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<BenefitPlanStatus>;
  @Column(DataType.DATEONLY) coverageStartsOn: string;
  @Column(DataType.DATEONLY) coverageEndsOn: string;
  @Column(DataType.DATEONLY) enrollmentOpensOn: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) enrollmentClosesOn: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) mandatory: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) requiresApproval: CreationOptional<boolean>;
  @Column(DataType.JSONB) employmentTypes: CreationOptional<EmploymentType[] | null>;
  @Column(DataType.JSONB) departmentIds: CreationOptional<string[] | null>;
  @Column(DataType.JSONB) locationIds: CreationOptional<string[] | null>;
  @Column(DataType.JSONB) gradeIds: CreationOptional<string[] | null>;
  @Column(DataType.INTEGER) waitingDays: CreationOptional<number>;
  @Column(DataType.INTEGER) maxChildAge: CreationOptional<number | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @HasMany(() => BenefitPlanOption, 'planId') options?: NonAttribute<BenefitPlanOption[]>;
}

@Table({ tableName: 'benefit_plan_options', underscored: true, timestamps: false })
export class BenefitPlanOption extends Model<InferAttributes<BenefitPlanOption>, InferCreationAttributes<BenefitPlanOption>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => BenefitPlan) @Column(DataType.UUID) planId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.DECIMAL(14, 2)) coverageAmount: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(12, 2)) employeeMonthly: CreationOptional<string>;
  @Column(DataType.DECIMAL(12, 2)) employerMonthly: CreationOptional<string>;
  @Column(DataType.JSONB) allowedRelations: CreationOptional<DependentRelation[]>;
  @Column(DataType.INTEGER) maxDependents: CreationOptional<number>;
  @Column(DataType.BOOLEAN) isDefault: CreationOptional<boolean>;
  @Column(DataType.INTEGER) sortOrder: CreationOptional<number>;
}

@Table({ tableName: 'benefit_enrollments', underscored: true })
export class BenefitEnrollment extends Model<InferAttributes<BenefitEnrollment>, InferCreationAttributes<BenefitEnrollment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => BenefitPlan) @Column(DataType.UUID) planId: string;
  @ForeignKey(() => BenefitPlanOption) @Column(DataType.UUID) optionId: CreationOptional<string | null>;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(10)) status: BenefitEnrollmentStatus;
  @Column(DataType.STRING(16)) reason: BenefitEnrollmentReason;
  @Column(DataType.STRING(20)) lifeEvent: CreationOptional<LifeEvent | null>;
  @Column(DataType.DATEONLY) lifeEventDate: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) note: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) effectiveFrom: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) effectiveTo: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) optionName: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(14, 2)) coverageAmount: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(12, 2)) employeeMonthly: CreationOptional<string>;
  @Column(DataType.DECIMAL(12, 2)) employerMonthly: CreationOptional<string>;
  @Column(DataType.UUID) replacesId: CreationOptional<string | null>;
  @Column(DataType.UUID) decidedById: CreationOptional<string | null>;
  @Column(DataType.DATE) decidedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(1000)) decisionNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => BenefitPlan, 'planId') plan?: NonAttribute<BenefitPlan>;
  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @HasMany(() => BenefitEnrollmentDependent, 'enrollmentId') dependents?: NonAttribute<BenefitEnrollmentDependent[]>;
}

@Table({ tableName: 'benefit_enrollment_dependents', underscored: true, timestamps: false })
export class BenefitEnrollmentDependent extends Model<InferAttributes<BenefitEnrollmentDependent>, InferCreationAttributes<BenefitEnrollmentDependent>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => BenefitEnrollment) @Column(DataType.UUID) enrollmentId: string;
  @Column(DataType.UUID) familyMemberId: CreationOptional<string | null>;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(20)) relationship: DependentRelation;
  @Column(DataType.DATEONLY) dateOfBirth: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) gender: CreationOptional<Gender | null>;
}
