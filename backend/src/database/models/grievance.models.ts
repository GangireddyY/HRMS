import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { GrievanceCategory, GrievanceOutcome, GrievancePriority, GrievanceStatus, GrievanceVisibility } from '../../contracts';
import { Employee } from './people.models';

/** A grievance or POSH complaint. Details and resolution are encrypted JSON (see GrievancesService). */
@Table({ tableName: 'grievance_cases', underscored: true })
export class GrievanceCase extends Model<InferAttributes<GrievanceCase>, InferCreationAttributes<GrievanceCase>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(16)) reference: string;
  @Column(DataType.STRING(16)) category: GrievanceCategory;
  @Column(DataType.STRING(150)) subject: string;
  @Column(DataType.TEXT) detailsEncrypted: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) complainantId: string;
  @ForeignKey(() => Employee) @Column(DataType.UUID) respondentId: CreationOptional<string | null>;
  @Column(DataType.STRING(150)) respondentName: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) incidentDate: CreationOptional<string | null>;
  @Column(DataType.STRING(200)) incidentLocation: CreationOptional<string | null>;
  @Column(DataType.STRING(8)) priority: CreationOptional<GrievancePriority>;
  @Column(DataType.STRING(14)) status: CreationOptional<GrievanceStatus>;
  @Column(DataType.UUID) assigneeUserId: CreationOptional<string | null>;
  @Column(DataType.DATEONLY) submittedOn: string;
  @Column(DataType.DATEONLY) dueOn: string;
  @Column(DataType.DATE) acknowledgedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(18)) outcome: CreationOptional<GrievanceOutcome | null>;
  @Column(DataType.TEXT) resolutionEncrypted: CreationOptional<string | null>;
  @Column(DataType.DATE) resolvedAt: CreationOptional<Date | null>;
  @Column(DataType.DATEONLY) resolvedOn: CreationOptional<string | null>;
  @Column(DataType.UUID) resolvedById: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) reopened: CreationOptional<boolean>;
  @Column(DataType.DATE) acceptedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) closedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) withdrawnAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;

  @BelongsTo(() => Employee, 'complainantId') complainant?: NonAttribute<Employee>;
  @BelongsTo(() => Employee, 'respondentId') respondent?: NonAttribute<Employee | null>;
}

@Table({ tableName: 'grievance_notes', underscored: true, updatedAt: false })
export class GrievanceNote extends Model<InferAttributes<GrievanceNote>, InferCreationAttributes<GrievanceNote>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => GrievanceCase) @Column(DataType.UUID) caseId: string;
  @Column(DataType.UUID) authorUserId: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) fromComplainant: boolean;
  @Column(DataType.STRING(8)) visibility: GrievanceVisibility;
  @Column(DataType.TEXT) bodyEncrypted: string;
  @CreatedAt createdAt: CreationOptional<Date>;
}

@Table({ tableName: 'grievance_attachments', underscored: true, updatedAt: false })
export class GrievanceAttachment extends Model<InferAttributes<GrievanceAttachment>, InferCreationAttributes<GrievanceAttachment>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => GrievanceCase) @Column(DataType.UUID) caseId: string;
  @Column(DataType.UUID) uploadedById: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) fromComplainant: boolean;
  @Column(DataType.STRING(8)) visibility: GrievanceVisibility;
  @Column(DataType.STRING(300)) storageKey: string;
  @Column(DataType.STRING(255)) fileName: string;
  @Column(DataType.STRING(100)) contentType: string;
  @Column(DataType.INTEGER) sizeBytes: number;
  @CreatedAt createdAt: CreationOptional<Date>;
}

@Table({ tableName: 'grievance_events', underscored: true, updatedAt: false })
export class GrievanceEvent extends Model<InferAttributes<GrievanceEvent>, InferCreationAttributes<GrievanceEvent>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => GrievanceCase) @Column(DataType.UUID) caseId: string;
  @Column(DataType.UUID) actorUserId: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) type: string;
  @Column(DataType.STRING(14)) fromStatus: CreationOptional<GrievanceStatus | null>;
  @Column(DataType.STRING(14)) toStatus: CreationOptional<GrievanceStatus | null>;
  @Column(DataType.STRING(300)) detail: CreationOptional<string | null>;
  @Column(DataType.BOOLEAN) internal: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
}
