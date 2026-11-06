import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { DocumentCategory, OnboardingAssignee, OnboardingCaseStatus, OnboardingTaskStatus, ProbationRecommendation, ProbationReviewStatus } from '../../contracts';
import { Employee } from './people.models';

@Table({ tableName: 'onboarding_templates', underscored: true })
export class OnboardingTemplate extends Model<InferAttributes<OnboardingTemplate>, InferCreationAttributes<OnboardingTemplate>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) isDefault: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @HasMany(() => OnboardingTemplateTask, 'templateId') tasks?: NonAttribute<OnboardingTemplateTask[]>;
}

@Table({ tableName: 'onboarding_template_tasks', underscored: true, timestamps: false })
export class OnboardingTemplateTask extends Model<InferAttributes<OnboardingTemplateTask>, InferCreationAttributes<OnboardingTemplateTask>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => OnboardingTemplate) @Column(DataType.UUID) templateId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(1000)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) assignee: OnboardingAssignee;
  @Column(DataType.STRING(30)) documentCategory: CreationOptional<DocumentCategory | null>;
  /** Days relative to the date of joining (negative = before joining). */
  @Column(DataType.SMALLINT) dueOffsetDays: CreationOptional<number>;
  @Column(DataType.BOOLEAN) isRequired: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;
}

@Table({ tableName: 'onboarding_cases', underscored: true })
export class OnboardingCase extends Model<InferAttributes<OnboardingCase>, InferCreationAttributes<OnboardingCase>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.UUID) templateId: CreationOptional<string | null>;
  @Column(DataType.STRING(12)) status: CreationOptional<OnboardingCaseStatus>;
  @Column(DataType.DATEONLY) joiningDate: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) buddyId: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) notes: CreationOptional<string | null>;
  @Column(DataType.DATE) completedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) completedById: CreationOptional<string | null>;
  @Column(DataType.DATE) cancelledAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) cancelReason: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => Employee, 'buddyId') buddy?: NonAttribute<Employee | null>;
  @HasMany(() => OnboardingTask, 'caseId') tasks?: NonAttribute<OnboardingTask[]>;
}

@Table({ tableName: 'onboarding_tasks', underscored: true })
export class OnboardingTask extends Model<InferAttributes<OnboardingTask>, InferCreationAttributes<OnboardingTask>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => OnboardingCase) @Column(DataType.UUID) caseId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(1000)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) assignee: OnboardingAssignee;
  @Column(DataType.STRING(30)) documentCategory: CreationOptional<DocumentCategory | null>;
  @Column(DataType.UUID) documentId: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) dueDate: string;
  @Column(DataType.BOOLEAN) isRequired: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;
  @Column(DataType.STRING(10)) status: CreationOptional<OnboardingTaskStatus>;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @Column(DataType.DATE) completedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) completedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => OnboardingCase, 'caseId') case?: NonAttribute<OnboardingCase>;
}

@Table({ tableName: 'probation_reviews', underscored: true })
export class ProbationReview extends Model<InferAttributes<ProbationReview>, InferCreationAttributes<ProbationReview>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATEONLY) probationEndDate: string;
  @Column(DataType.STRING(10)) recommendation: ProbationRecommendation;
  @Column(DataType.DATEONLY) extendTo: CreationOptional<string | null>;
  @Column(DataType.STRING(1000)) comments: string;
  @Column(DataType.STRING(10)) status: CreationOptional<ProbationReviewStatus>;
  @Column(DataType.UUID) submittedById: CreationOptional<string | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}
