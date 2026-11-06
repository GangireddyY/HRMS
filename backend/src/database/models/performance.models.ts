import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { Competency, CycleStatus, FeedbackStatus, PipObjective, PipProgress, PipStatus, ReviewStage } from '../../contracts';
import { Employee } from './people.models';

export interface CompetencyRating {
  key: string;
  rating: number | null;
  comment: string | null;
}

/** Decimal columns come back from PostgreSQL as strings. */
@Table({ tableName: 'performance_cycles', underscored: true })
export class PerformanceCycle extends Model<InferAttributes<PerformanceCycle>, InferCreationAttributes<PerformanceCycle>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(1000)) description: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) periodStart: string;
  @Column(DataType.DATEONLY) periodEnd: string;
  @Column(DataType.DATEONLY) goalsDue: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) selfReviewDue: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) managerReviewDue: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) goalsWeight: CreationOptional<number>;
  @Column(DataType.JSONB) competencies: CreationOptional<Competency[]>;
  @Column(DataType.JSONB) ratingLabels: string[];
  @Column(DataType.DATEONLY) eligibilityCutoff: CreationOptional<string | null>;
  @Column(DataType.JSONB) departmentIds: CreationOptional<string[] | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<CycleStatus>;
  @Column(DataType.DATE) launchedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) resultsReleasedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'performance_reviews', underscored: true })
export class PerformanceReview extends Model<InferAttributes<PerformanceReview>, InferCreationAttributes<PerformanceReview>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PerformanceCycle) @Column(DataType.UUID) cycleId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) reviewerId: CreationOptional<string | null>;
  @Column(DataType.STRING(16)) stage: CreationOptional<ReviewStage>;
  @Column(DataType.DATE) goalsSubmittedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) goalsApprovedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(1000)) goalsReturnNote: CreationOptional<string | null>;
  @Column(DataType.JSONB) selfCompetencies: CreationOptional<CompetencyRating[]>;
  @Column(DataType.TEXT) selfComment: CreationOptional<string | null>;
  @Column(DataType.DATE) selfSubmittedAt: CreationOptional<Date | null>;
  @Column(DataType.JSONB) managerCompetencies: CreationOptional<CompetencyRating[]>;
  @Column(DataType.TEXT) managerComment: CreationOptional<string | null>;
  @Column(DataType.TEXT) strengths: CreationOptional<string | null>;
  @Column(DataType.TEXT) improvements: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(3, 2)) goalScore: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(3, 2)) competencyScore: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(3, 2)) overallScore: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) finalRating: CreationOptional<number | null>;
  @Column(DataType.DATE) managerSubmittedAt: CreationOptional<Date | null>;
  @Column(DataType.SMALLINT) calibratedRating: CreationOptional<number | null>;
  @Column(DataType.STRING(1000)) calibrationNote: CreationOptional<string | null>;
  @Column(DataType.UUID) calibratedById: CreationOptional<string | null>;
  @Column(DataType.DATE) calibratedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) acknowledgedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(2000)) employeeResponse: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => PerformanceCycle, 'cycleId') cycle?: NonAttribute<PerformanceCycle>;
  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => Employee, 'reviewerId') reviewer?: NonAttribute<Employee | null>;
  @HasMany(() => PerformanceGoal, 'reviewId') goals?: NonAttribute<PerformanceGoal[]>;
  @HasMany(() => PerformanceFeedback, 'reviewId') feedback?: NonAttribute<PerformanceFeedback[]>;
}

@Table({ tableName: 'performance_goals', underscored: true })
export class PerformanceGoal extends Model<InferAttributes<PerformanceGoal>, InferCreationAttributes<PerformanceGoal>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PerformanceReview) @Column(DataType.UUID) reviewId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(2000)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) measure: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) weight: number;
  @Column(DataType.DATEONLY) dueDate: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) progress: CreationOptional<number>;
  @Column(DataType.STRING(1000)) progressNote: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) selfRating: CreationOptional<number | null>;
  @Column(DataType.STRING(2000)) selfComment: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) managerRating: CreationOptional<number | null>;
  @Column(DataType.STRING(2000)) managerComment: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

@Table({ tableName: 'performance_feedback', underscored: true })
export class PerformanceFeedback extends Model<InferAttributes<PerformanceFeedback>, InferCreationAttributes<PerformanceFeedback>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PerformanceReview) @Column(DataType.UUID) reviewId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) giverId: string;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<FeedbackStatus>;
  @Column(DataType.SMALLINT) rating: CreationOptional<number | null>;
  @Column(DataType.STRING(2000)) strengths: CreationOptional<string | null>;
  @Column(DataType.STRING(2000)) improvements: CreationOptional<string | null>;
  @Column(DataType.DATE) submittedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => PerformanceReview, 'reviewId') review?: NonAttribute<PerformanceReview>;
  @BelongsTo(() => Employee, 'giverId') giver?: NonAttribute<Employee>;
}

@Table({ tableName: 'performance_pips', underscored: true })
export class PerformancePip extends Model<InferAttributes<PerformancePip>, InferCreationAttributes<PerformancePip>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) ownerId: CreationOptional<string | null>;
  @ForeignKey(() => PerformanceReview) @Column(DataType.UUID) reviewId: CreationOptional<string | null>;
  @Column(DataType.STRING(2000)) reason: string;
  @Column(DataType.JSONB) objectives: PipObjective[];
  @Column(DataType.DATEONLY) startDate: string;
  @Column(DataType.DATEONLY) endDate: string;
  @Column(DataType.STRING(12)) status: CreationOptional<PipStatus>;
  @Column(DataType.STRING(2000)) outcomeNote: CreationOptional<string | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) closedById: CreationOptional<string | null>;
  @Column(DataType.DATE) acknowledgedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(2000)) employeeComment: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => Employee, 'ownerId') owner?: NonAttribute<Employee | null>;
  @HasMany(() => PipCheckIn, 'pipId') checkIns?: NonAttribute<PipCheckIn[]>;
}

@Table({ tableName: 'pip_check_ins', underscored: true, updatedAt: false })
export class PipCheckIn extends Model<InferAttributes<PipCheckIn>, InferCreationAttributes<PipCheckIn>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PerformancePip) @Column(DataType.UUID) pipId: string;
  @Column(DataType.DATEONLY) checkInDate: string;
  @Column(DataType.STRING(16)) progress: PipProgress;
  @Column(DataType.STRING(2000)) note: string;
  @CreatedAt createdAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}
