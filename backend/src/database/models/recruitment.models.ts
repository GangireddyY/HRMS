import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, HasOne, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type {
  ApplicationStage,
  CandidateSource,
  EmploymentType,
  FeedbackRecommendation,
  InterviewMode,
  InterviewStatus,
  JobStatus,
  OfferStatus,
  RequisitionReason,
  RequisitionStatus,
} from '../../contracts';
import { Department, Designation, Employee, Location } from './people.models';

/** Decimal columns come back from PostgreSQL as strings. */
@Table({ tableName: 'job_requisitions', underscored: true })
export class JobRequisition extends Model<InferAttributes<JobRequisition>, InferCreationAttributes<JobRequisition>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) code: string;
  @Column(DataType.STRING(150)) title: string;
  @ForeignKey(() => Department) @Column(DataType.UUID) departmentId: CreationOptional<string | null>;
  @ForeignKey(() => Designation) @Column(DataType.UUID) designationId: CreationOptional<string | null>;
  @ForeignKey(() => Location) @Column(DataType.UUID) locationId: CreationOptional<string | null>;
  @ForeignKey(() => Employee) @Column(DataType.UUID) hiringManagerId: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) employmentType: CreationOptional<EmploymentType>;
  @Column(DataType.SMALLINT) openings: CreationOptional<number>;
  @Column(DataType.SMALLINT) hiredCount: CreationOptional<number>;
  @Column(DataType.STRING(20)) reason: RequisitionReason;
  @Column(DataType.STRING(1000)) justification: string;
  @Column(DataType.DECIMAL(14, 2)) budgetMin: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(14, 2)) budgetMax: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) targetDate: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) status: CreationOptional<RequisitionStatus>;
  @Column(DataType.UUID) requestedById: CreationOptional<string | null>;
  @Column(DataType.DATE) submittedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) reviewedById: CreationOptional<string | null>;
  @Column(DataType.DATE) reviewedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) reviewNote: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Department, 'departmentId') department?: NonAttribute<Department | null>;
  @BelongsTo(() => Designation, 'designationId') designation?: NonAttribute<Designation | null>;
  @BelongsTo(() => Location, 'locationId') location?: NonAttribute<Location | null>;
  @BelongsTo(() => Employee, 'hiringManagerId') hiringManager?: NonAttribute<Employee | null>;
  @HasOne(() => JobOpening, 'requisitionId') job?: NonAttribute<JobOpening | null>;
}

@Table({ tableName: 'job_openings', underscored: true })
export class JobOpening extends Model<InferAttributes<JobOpening>, InferCreationAttributes<JobOpening>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => JobRequisition) @Column(DataType.UUID) requisitionId: string;
  @Column(DataType.STRING(150)) title: string;
  @Column(DataType.TEXT) description: string;
  @Column(DataType.TEXT) requirements: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) experienceMin: CreationOptional<number | null>;
  @Column(DataType.SMALLINT) experienceMax: CreationOptional<number | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<JobStatus>;
  @Column(DataType.BOOLEAN) isPublic: CreationOptional<boolean>;
  @Column(DataType.DATEONLY) closesOn: CreationOptional<string | null>;
  @Column(DataType.DATE) openedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => JobRequisition, 'requisitionId') requisition?: NonAttribute<JobRequisition>;
  @HasMany(() => JobApplication, 'jobId') applications?: NonAttribute<JobApplication[]>;
}

@Table({ tableName: 'candidates', underscored: true })
export class Candidate extends Model<InferAttributes<Candidate>, InferCreationAttributes<Candidate>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(100)) firstName: string;
  @Column(DataType.STRING(100)) lastName: string;
  @Column(DataType.STRING(254)) email: string;
  @Column(DataType.STRING(30)) phone: CreationOptional<string | null>;
  @Column(DataType.STRING(150)) currentCompany: CreationOptional<string | null>;
  @Column(DataType.STRING(150)) currentTitle: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(4, 1)) experienceYears: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(14, 2)) currentCtc: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(14, 2)) expectedCtc: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) noticePeriodDays: CreationOptional<number | null>;
  @Column(DataType.STRING(120)) location: CreationOptional<string | null>;
  @Column(DataType.STRING(300)) linkedinUrl: CreationOptional<string | null>;
  @Column(DataType.STRING(12)) source: CreationOptional<CandidateSource>;
  @ForeignKey(() => Employee) @Column(DataType.UUID) referredById: CreationOptional<string | null>;
  @Column(DataType.STRING(2000)) notes: CreationOptional<string | null>;
  @Default([]) @Column(DataType.JSONB) skills: CreationOptional<string[]>;
  @Column(DataType.STRING(500)) resumeKey: CreationOptional<string | null>;
  @Column(DataType.STRING(255)) resumeFileName: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) resumeContentType: CreationOptional<string | null>;
  @Column(DataType.INTEGER) resumeSize: CreationOptional<number | null>;
  @Column(DataType.DATE) resumeUploadedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) consentAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'referredById') referredBy?: NonAttribute<Employee | null>;
  @HasMany(() => JobApplication, 'candidateId') applications?: NonAttribute<JobApplication[]>;
}

@Table({ tableName: 'job_applications', underscored: true })
export class JobApplication extends Model<InferAttributes<JobApplication>, InferCreationAttributes<JobApplication>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => JobOpening) @Column(DataType.UUID) jobId: string;
  @ForeignKey(() => Candidate) @Column(DataType.UUID) candidateId: string;
  @Column(DataType.STRING(12)) stage: CreationOptional<ApplicationStage>;
  @Column(DataType.DATE) stageChangedAt: CreationOptional<Date>;
  @Column(DataType.STRING(500)) rejectionReason: CreationOptional<string | null>;
  @Column(DataType.STRING(12)) source: CreationOptional<CandidateSource>;
  @ForeignKey(() => Employee) @Column(DataType.UUID) hiredEmployeeId: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => JobOpening, 'jobId') job?: NonAttribute<JobOpening>;
  @BelongsTo(() => Candidate, 'candidateId') candidate?: NonAttribute<Candidate>;
  @HasMany(() => ApplicationEvent, 'applicationId') events?: NonAttribute<ApplicationEvent[]>;
  @HasMany(() => Interview, 'applicationId') interviews?: NonAttribute<Interview[]>;
  @HasMany(() => Offer, 'applicationId') offers?: NonAttribute<Offer[]>;
}

@Table({ tableName: 'application_events', underscored: true, updatedAt: false })
export class ApplicationEvent extends Model<InferAttributes<ApplicationEvent>, InferCreationAttributes<ApplicationEvent>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => JobApplication) @Column(DataType.UUID) applicationId: string;
  @Column(DataType.STRING(12)) fromStage: CreationOptional<ApplicationStage | null>;
  @Column(DataType.STRING(12)) toStage: ApplicationStage;
  @Column(DataType.STRING(1000)) note: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
}

@Table({ tableName: 'interviews', underscored: true })
export class Interview extends Model<InferAttributes<Interview>, InferCreationAttributes<Interview>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => JobApplication) @Column(DataType.UUID) applicationId: string;
  @Column(DataType.STRING(120)) roundName: string;
  @Column(DataType.DATE) scheduledAt: Date;
  @Column(DataType.SMALLINT) durationMinutes: CreationOptional<number>;
  @Column(DataType.STRING(10)) mode: CreationOptional<InterviewMode>;
  @Column(DataType.STRING(500)) location: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<InterviewStatus>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => JobApplication, 'applicationId') application?: NonAttribute<JobApplication>;
  @HasMany(() => InterviewPanelist, 'interviewId') panelists?: NonAttribute<InterviewPanelist[]>;
}

@Table({ tableName: 'interview_panelists', underscored: true, timestamps: false })
export class InterviewPanelist extends Model<InferAttributes<InterviewPanelist>, InferCreationAttributes<InterviewPanelist>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Interview) @Column(DataType.UUID) interviewId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.SMALLINT) rating: CreationOptional<number | null>;
  @Column(DataType.STRING(16)) recommendation: CreationOptional<FeedbackRecommendation | null>;
  @Column(DataType.STRING(4000)) feedback: CreationOptional<string | null>;
  @Column(DataType.DATE) submittedAt: CreationOptional<Date | null>;

  @BelongsTo(() => Interview, 'interviewId') interview?: NonAttribute<Interview>;
  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

@Table({ tableName: 'offers', underscored: true })
export class Offer extends Model<InferAttributes<Offer>, InferCreationAttributes<Offer>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => JobApplication) @Column(DataType.UUID) applicationId: string;
  @ForeignKey(() => Designation) @Column(DataType.UUID) designationId: CreationOptional<string | null>;
  @ForeignKey(() => Department) @Column(DataType.UUID) departmentId: CreationOptional<string | null>;
  @ForeignKey(() => Location) @Column(DataType.UUID) locationId: CreationOptional<string | null>;
  @Column(DataType.DECIMAL(14, 2)) annualCtc: string;
  @Column(DataType.DATEONLY) joiningDate: string;
  @Column(DataType.DATEONLY) expiresOn: CreationOptional<string | null>;
  @Column(DataType.STRING(2000)) notes: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<OfferStatus>;
  @Column(DataType.DATE) releasedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) respondedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) declineReason: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => JobApplication, 'applicationId') application?: NonAttribute<JobApplication>;
  @BelongsTo(() => Designation, 'designationId') designation?: NonAttribute<Designation | null>;
  @BelongsTo(() => Department, 'departmentId') department?: NonAttribute<Department | null>;
  @BelongsTo(() => Location, 'locationId') location?: NonAttribute<Location | null>;
}
