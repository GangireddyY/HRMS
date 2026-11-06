import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
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
