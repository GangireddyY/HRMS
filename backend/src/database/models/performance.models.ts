import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type {
  SuccessionLevel,
  SuccessorReadiness,
  Competency,
  CycleStatus,
  FeedbackStatus,
  HikeStatus,
  MeritGuideline,
  OkrHealth,
  OkrLevel,
  OkrMetric,
  OkrStatus,
  OneOnOneItemKind,
  OneOnOneStatus,
  PipObjective,
  PipProgress,
  PipStatus,
  ReviewStage,
} from '../../contracts';
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
  @Column(DataType.JSONB) meritMatrix: CreationOptional<MeritGuideline[] | null>;
  @Column(DataType.DECIMAL(5, 2)) hikeBudgetPercent: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) hikeEffectiveFrom: CreationOptional<string | null>;
  /** Calibration target: percent of people at ratings 1 → 5 (sums to 100). */
  @Column(DataType.JSONB) targetDistribution: CreationOptional<number[] | null>;
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
  /** 1–3, for the 9-box (with the final rating as performance). */
  @Column(DataType.SMALLINT) potential: CreationOptional<number | null>;
  @Column(DataType.UUID) potentialSetById: CreationOptional<string | null>;
  @Column(DataType.DATE) potentialSetAt: CreationOptional<Date | null>;
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

/** A salary-hike recommendation for a reviewed employee, taken through approval to a salary revision. */
@Table({ tableName: 'hike_recommendations', underscored: true })
export class HikeRecommendation extends Model<InferAttributes<HikeRecommendation>, InferCreationAttributes<HikeRecommendation>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PerformanceCycle) @Column(DataType.UUID) cycleId: string;
  @ForeignKey(() => PerformanceReview) @Column(DataType.UUID) reviewId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.SMALLINT) rating: number;
  @Column(DataType.DECIMAL(14, 2)) currentCtc: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(5, 2)) percent: string;
  @Column(DataType.DECIMAL(14, 2)) newCtc: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) promotion: CreationOptional<boolean>;
  @Column(DataType.STRING(1000)) justification: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<HikeStatus>;
  @Column(DataType.UUID) recommendedById: CreationOptional<string | null>;
  @Column(DataType.DATE) submittedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) decidedById: CreationOptional<string | null>;
  @Column(DataType.DATE) decidedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(1000)) decisionNote: CreationOptional<string | null>;
  @Column(DataType.UUID) salaryId: CreationOptional<string | null>;
  @Column(DataType.DATE) appliedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @BelongsTo(() => PerformanceReview, 'reviewId') review?: NonAttribute<PerformanceReview>;
}

/** An objective (OKR) for the company, a department or a person, aligned to a parent objective. */
@Table({ tableName: 'okr_objectives', underscored: true })
export class OkrObjective extends Model<InferAttributes<OkrObjective>, InferCreationAttributes<OkrObjective>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(2000)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(12)) level: OkrLevel;
  @ForeignKey(() => Employee) @Column(DataType.UUID) ownerEmployeeId: CreationOptional<string | null>;
  @Column(DataType.UUID) departmentId: CreationOptional<string | null>;
  @Column(DataType.UUID) parentId: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) periodStart: string;
  @Column(DataType.DATEONLY) periodEnd: string;
  @Column(DataType.STRING(8)) status: CreationOptional<OkrStatus>;
  @Column(DataType.SMALLINT) progress: CreationOptional<number>;
  @Column(DataType.STRING(10)) health: CreationOptional<OkrHealth | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'ownerEmployeeId') owner?: NonAttribute<Employee | null>;
  @HasMany(() => OkrKeyResult, 'objectiveId') keyResults?: NonAttribute<OkrKeyResult[]>;
}

@Table({ tableName: 'okr_key_results', underscored: true })
export class OkrKeyResult extends Model<InferAttributes<OkrKeyResult>, InferCreationAttributes<OkrKeyResult>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => OkrObjective) @Column(DataType.UUID) objectiveId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(10)) metric: OkrMetric;
  @Column(DataType.DECIMAL(14, 2)) startValue: CreationOptional<string>;
  @Column(DataType.DECIMAL(14, 2)) targetValue: string;
  @Column(DataType.DECIMAL(14, 2)) currentValue: CreationOptional<string>;
  @Column(DataType.STRING(20)) unit: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) weight: CreationOptional<number>;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;
  @Column(DataType.DATE) lastCheckInAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'okr_check_ins', underscored: true, updatedAt: false })
export class OkrCheckIn extends Model<InferAttributes<OkrCheckIn>, InferCreationAttributes<OkrCheckIn>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => OkrKeyResult) @Column(DataType.UUID) keyResultId: string;
  @Column(DataType.DECIMAL(14, 2)) value: string;
  @Column(DataType.STRING(10)) health: OkrHealth;
  @Column(DataType.STRING(1000)) note: CreationOptional<string | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
}

/** A 1:1 between a manager and one of their people: shared agenda and notes, the manager's private notes, actions. */
@Table({ tableName: 'one_on_ones', underscored: true })
export class OneOnOne extends Model<InferAttributes<OneOnOne>, InferCreationAttributes<OneOnOne>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) managerId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATE) scheduledAt: Date;
  @Column(DataType.SMALLINT) durationMinutes: CreationOptional<number>;
  @Column(DataType.STRING(10)) status: CreationOptional<OneOnOneStatus>;
  @Column(DataType.TEXT) sharedNotes: CreationOptional<string | null>;
  @Column(DataType.TEXT) managerNotes: CreationOptional<string | null>;
  @Column(DataType.DATE) completedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'managerId') manager?: NonAttribute<Employee>;
  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
  @HasMany(() => OneOnOneItem, 'meetingId') items?: NonAttribute<OneOnOneItem[]>;
}

@Table({ tableName: 'one_on_one_items', underscored: true, updatedAt: false })
export class OneOnOneItem extends Model<InferAttributes<OneOnOneItem>, InferCreationAttributes<OneOnOneItem>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => OneOnOne) @Column(DataType.UUID) meetingId: string;
  @Column(DataType.STRING(8)) kind: OneOnOneItemKind;
  @Column(DataType.STRING(500)) text: string;
  @Column(DataType.UUID) addedById: CreationOptional<string | null>;
  @Column(DataType.UUID) ownerEmployeeId: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) dueDate: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) done: CreationOptional<boolean>;
  @Column(DataType.DATE) doneAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
}

/** A department's pool for a cycle's salary increases (annual CTC). */
@Table({ tableName: 'compensation_budgets', underscored: true })
export class CompensationBudget extends Model<InferAttributes<CompensationBudget>, InferCreationAttributes<CompensationBudget>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => PerformanceCycle) @Column(DataType.UUID) cycleId: string;
  @Column(DataType.UUID) departmentId: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(14, 2)) amount: string;
  @Column(DataType.STRING(500)) note: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** A critical role, its current holder (or vacant), and the people who could step in. */
@Table({ tableName: 'succession_plans', underscored: true })
export class SuccessionPlan extends Model<InferAttributes<SuccessionPlan>, InferCreationAttributes<SuccessionPlan>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(150)) title: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) incumbentEmployeeId: CreationOptional<string | null>;
  @Column(DataType.UUID) departmentId: CreationOptional<string | null>;
  @Column(DataType.STRING(6)) criticality: CreationOptional<SuccessionLevel>;
  @Column(DataType.STRING(6)) riskOfLoss: CreationOptional<SuccessionLevel>;
  @Column(DataType.STRING(2000)) notes: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) reviewBy: CreationOptional<string | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'incumbentEmployeeId') incumbent?: NonAttribute<Employee | null>;
  @HasMany(() => SuccessionCandidate, 'planId') candidates?: NonAttribute<SuccessionCandidate[]>;
}

@Table({ tableName: 'succession_candidates', underscored: true })
export class SuccessionCandidate extends Model<InferAttributes<SuccessionCandidate>, InferCreationAttributes<SuccessionCandidate>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => SuccessionPlan) @Column(DataType.UUID) planId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.STRING(16)) readiness: SuccessorReadiness;
  @Column(DataType.SMALLINT) rank: CreationOptional<number>;
  @Column(DataType.STRING(2000)) developmentNotes: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}
