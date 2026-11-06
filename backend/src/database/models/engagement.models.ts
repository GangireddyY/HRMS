import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type {
  AnnouncementCategory,
  AnnouncementStatus,
  RecognitionBadge,
  RsvpResponse,
  SuggestionCategory,
  SuggestionStatus,
  SurveyQuestionType,
  SurveyStatus,
} from '../../contracts';
import { Employee } from './people.models';

@Table({ tableName: 'announcements', underscored: true })
export class Announcement extends Model<InferAttributes<Announcement>, InferCreationAttributes<Announcement>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.TEXT) body: string;
  @Column(DataType.STRING(12)) category: CreationOptional<AnnouncementCategory>;
  @Column(DataType.BOOLEAN) pinned: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) requiresAck: CreationOptional<boolean>;
  @Column(DataType.JSONB) departmentIds: CreationOptional<string[] | null>;
  @Column(DataType.JSONB) locationIds: CreationOptional<string[] | null>;
  @Column(DataType.DATE) eventStartsAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) eventEndsAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(300)) eventLocation: CreationOptional<string | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<AnnouncementStatus>;
  @Column(DataType.DATE) publishedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) expiresAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'announcement_responses', underscored: true })
export class AnnouncementResponse extends Model<InferAttributes<AnnouncementResponse>, InferCreationAttributes<AnnouncementResponse>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Announcement) @Column(DataType.UUID) announcementId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATE) acknowledgedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(10)) rsvp: CreationOptional<RsvpResponse | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

@Table({ tableName: 'surveys', underscored: true })
export class Survey extends Model<InferAttributes<Survey>, InferCreationAttributes<Survey>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(2000)) description: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) anonymous: CreationOptional<boolean>;
  @Column(DataType.JSONB) departmentIds: CreationOptional<string[] | null>;
  @Column(DataType.STRING(10)) status: CreationOptional<SurveyStatus>;
  @Column(DataType.DATE) openedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) closesAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @HasMany(() => SurveyQuestionRecord, 'surveyId') questions?: NonAttribute<SurveyQuestionRecord[]>;
}

@Table({ tableName: 'survey_questions', underscored: true, timestamps: false })
export class SurveyQuestionRecord extends Model<InferAttributes<SurveyQuestionRecord>, InferCreationAttributes<SurveyQuestionRecord>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Survey) @Column(DataType.UUID) surveyId: string;
  @Column(DataType.STRING(10)) type: SurveyQuestionType;
  @Column(DataType.STRING(500)) prompt: string;
  @Column(DataType.JSONB) options: CreationOptional<string[]>;
  @Column(DataType.BOOLEAN) required: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;
}

@Table({ tableName: 'survey_participants', underscored: true, timestamps: false })
export class SurveyParticipant extends Model<InferAttributes<SurveyParticipant>, InferCreationAttributes<SurveyParticipant>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Survey) @Column(DataType.UUID) surveyId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;
  @Column(DataType.DATEONLY) respondedOn: string;
}

@Table({ tableName: 'survey_responses', underscored: true, timestamps: false })
export class SurveyResponse extends Model<InferAttributes<SurveyResponse>, InferCreationAttributes<SurveyResponse>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Survey) @Column(DataType.UUID) surveyId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: CreationOptional<string | null>;
  @Column(DataType.JSONB) answers: Record<string, number | string>;
  @Column(DataType.DATEONLY) submittedOn: string;
}

@Table({ tableName: 'recognitions', underscored: true, updatedAt: false })
export class Recognition extends Model<InferAttributes<Recognition>, InferCreationAttributes<Recognition>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) giverId: string;
  @Column(DataType.STRING(20)) badge: RecognitionBadge;
  @Column(DataType.STRING(1000)) message: string;
  @CreatedAt createdAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'giverId') giver?: NonAttribute<Employee>;
  @HasMany(() => RecognitionRecipient, 'recognitionId') recipients?: NonAttribute<RecognitionRecipient[]>;
}

@Table({ tableName: 'recognition_recipients', underscored: true, timestamps: false })
export class RecognitionRecipient extends Model<InferAttributes<RecognitionRecipient>, InferCreationAttributes<RecognitionRecipient>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Recognition) @Column(DataType.UUID) recognitionId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: string;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee>;
}

@Table({ tableName: 'suggestions', underscored: true })
export class Suggestion extends Model<InferAttributes<Suggestion>, InferCreationAttributes<Suggestion>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) employeeId: CreationOptional<string | null>;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.STRING(4000)) body: string;
  @Column(DataType.STRING(12)) category: SuggestionCategory;
  @Column(DataType.STRING(14)) status: CreationOptional<SuggestionStatus>;
  @Column(DataType.STRING(2000)) response: CreationOptional<string | null>;
  @Column(DataType.UUID) respondedById: CreationOptional<string | null>;
  @Column(DataType.DATE) respondedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => Employee, 'employeeId') employee?: NonAttribute<Employee | null>;
}
