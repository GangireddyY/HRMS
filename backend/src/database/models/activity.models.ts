import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { LogArchiveKind, LogArchiveStatus } from '../../contracts';
import { User } from './identity.models';
import { Organization } from './organization.models';

/**
 * Append-only audit trail (UPDATE/DELETE blocked by a database trigger). `changes` holds a redacted
 * before/after diff; JSON is appropriate because the shape varies per entity and is never queried relationally.
 */
@Table({ tableName: 'audit_logs', underscored: true, updatedAt: false })
export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: CreationOptional<string | null>;

  @ForeignKey(() => User) @Column(DataType.UUID)
  actorUserId: CreationOptional<string | null>;

  @Column(DataType.STRING(100)) action: string;
  @Column(DataType.STRING(100)) entityType: string;
  @Column(DataType.STRING(64)) entityId: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) summary: CreationOptional<string | null>;
  @Column(DataType.JSONB) changes: CreationOptional<Record<string, { from: unknown; to: unknown }> | null>;
  @Column(DataType.JSONB) metadata: CreationOptional<Record<string, unknown> | null>;
  @Column(DataType.STRING(64)) ipAddress: CreationOptional<string | null>;
  @Column(DataType.STRING(512)) userAgent: CreationOptional<string | null>;
  @Column(DataType.STRING(64)) requestId: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;

  @BelongsTo(() => User, 'actorUserId')
  actor?: NonAttribute<User | null>;

  @BelongsTo(() => Organization, 'organizationId')
  organization?: NonAttribute<Organization | null>;
}

/**
 * A CSV file of audit trail or login history records created before `recordsBefore`. Records can only be deleted
 * through an archive whose file has been downloaded, and exactly the archived records are removed.
 */
@Table({ tableName: 'log_archives', underscored: true })
export class LogArchive extends Model<InferAttributes<LogArchive>, InferCreationAttributes<LogArchive>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) kind: LogArchiveKind;
  @Column(DataType.DATE) recordsBefore: Date;
  @Column(DataType.DATE) firstRecordAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) lastRecordAt: CreationOptional<Date | null>;
  @Column(DataType.INTEGER) recordCount: number;
  @Column(DataType.STRING(200)) fileName: string;
  @Column(DataType.STRING(500)) storageKey: string;
  @Column(DataType.INTEGER) sizeBytes: number;
  @Column(DataType.CHAR(64)) sha256: string;
  @Column(DataType.STRING(20)) status: CreationOptional<LogArchiveStatus>;
  @Column(DataType.DATE) downloadedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) purgedAt: CreationOptional<Date | null>;
  @Column(DataType.INTEGER) purgedCount: CreationOptional<number | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @ForeignKey(() => User) @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @ForeignKey(() => User) @Column(DataType.UUID) purgedById: CreationOptional<string | null>;

  @BelongsTo(() => User, 'createdById')
  createdBy?: NonAttribute<User | null>;

  @BelongsTo(() => User, 'purgedById')
  purgedBy?: NonAttribute<User | null>;
}

@Table({ tableName: 'notifications', underscored: true, updatedAt: false })
export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: CreationOptional<string | null>;

  @ForeignKey(() => User) @Column(DataType.UUID)
  userId: string;

  @Column(DataType.STRING(50)) type: string;
  @Column(DataType.STRING(200)) title: string;
  @Column(DataType.TEXT) body: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) link: CreationOptional<string | null>;
  @Column(DataType.DATE) readAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
}
