import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { BuilderDataset, BuilderQuery, CustomFieldEntity, CustomFieldType, ReportFrequency, ReportPeriod, ReportRunStatus } from '../../contracts';

/** A report-builder report someone saved. */
@Table({ tableName: 'saved_reports', underscored: true })
export class SavedReport extends Model<InferAttributes<SavedReport>, InferCreationAttributes<SavedReport>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.UUID) ownerId: string;
  @Column(DataType.STRING(120)) name: string;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  @Column(DataType.STRING(30)) dataset: BuilderDataset;
  @Column(DataType.JSONB) definition: Omit<BuilderQuery, 'dataset'>;
  @Column(DataType.BOOLEAN) shared: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** A saved report emailed on a schedule (each recipient gets what their own access allows). */
@Table({ tableName: 'report_schedules', underscored: true })
export class ReportSchedule extends Model<InferAttributes<ReportSchedule>, InferCreationAttributes<ReportSchedule>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.UUID) savedReportId: string;
  @Column(DataType.UUID) ownerId: string;
  @Column(DataType.STRING(8)) frequency: ReportFrequency;
  @Column(DataType.SMALLINT) dayOfWeek: CreationOptional<number | null>;
  @Column(DataType.SMALLINT) dayOfMonth: CreationOptional<number | null>;
  @Column(DataType.SMALLINT) hour: CreationOptional<number>;
  @Column(DataType.STRING(4)) format: CreationOptional<'csv' | 'xlsx'>;
  @Column(DataType.STRING(16)) period: CreationOptional<ReportPeriod>;
  @Column(DataType.JSONB) recipientIds: CreationOptional<string[]>;
  @Column(DataType.BOOLEAN) isActive: CreationOptional<boolean>;
  @Column(DataType.DATE) nextRunAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) lastRunAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(8)) lastStatus: CreationOptional<ReportRunStatus | null>;
  @Column(DataType.STRING(500)) lastError: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** An extra field the organization defines on employees. */
@Table({ tableName: 'custom_field_definitions', underscored: true })
export class CustomFieldDefinition extends Model<InferAttributes<CustomFieldDefinition>, InferCreationAttributes<CustomFieldDefinition>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(20)) entity: CreationOptional<CustomFieldEntity>;
  @Column(DataType.STRING(40)) key: string;
  @Column(DataType.STRING(80)) label: string;
  @Column(DataType.STRING(12)) type: CustomFieldType;
  @Column(DataType.ARRAY(DataType.STRING(80))) options: CreationOptional<string[]>;
  @Column(DataType.BOOLEAN) required: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) sensitive: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) employeeEditable: CreationOptional<boolean>;
  @Column(DataType.STRING(60)) section: CreationOptional<string | null>;
  @Column(DataType.STRING(200)) helpText: CreationOptional<string | null>;
  @Column(DataType.SMALLINT) sortOrder: CreationOptional<number>;
  @Column(DataType.DATE) archivedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** A read-only API key acting for its creator, limited to its permissions (and to what the creator still holds). */
@Table({ tableName: 'api_keys', underscored: true })
export class ApiKey extends Model<InferAttributes<ApiKey>, InferCreationAttributes<ApiKey>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(100)) name: string;
  @Column(DataType.STRING(20)) prefix: string;
  @Column(DataType.CHAR(64)) keyHash: string;
  @Column(DataType.ARRAY(DataType.STRING(100))) permissions: string[];
  @Column(DataType.UUID) createdById: string;
  @Column(DataType.DATE) lastUsedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(64)) lastUsedIp: CreationOptional<string | null>;
  @Column(DataType.DATE) expiresAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) revokedAt: CreationOptional<Date | null>;
  @Column(DataType.UUID) revokedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'webhook_endpoints', underscored: true })
export class WebhookEndpoint extends Model<InferAttributes<WebhookEndpoint>, InferCreationAttributes<WebhookEndpoint>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(500)) url: string;
  @Column(DataType.STRING(200)) description: CreationOptional<string | null>;
  @Column(DataType.ARRAY(DataType.STRING(100))) events: string[];
  @Column(DataType.TEXT) secretEncrypted: string;
  @Column(DataType.BOOLEAN) enabled: CreationOptional<boolean>;
  @Column(DataType.INTEGER) consecutiveFailures: CreationOptional<number>;
  @Column(DataType.STRING(200)) disabledReason: CreationOptional<string | null>;
  @Column(DataType.DATE) lastDeliveryAt: CreationOptional<Date | null>;
  @Column(DataType.SMALLINT) lastStatus: CreationOptional<number | null>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'webhook_deliveries', underscored: true })
export class WebhookDelivery extends Model<InferAttributes<WebhookDelivery>, InferCreationAttributes<WebhookDelivery>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @ForeignKey(() => WebhookEndpoint) @Column(DataType.UUID) endpointId: string;
  @Column(DataType.STRING(100)) event: string;
  @Column(DataType.JSONB) payload: Record<string, unknown>;
  @Column(DataType.STRING(8)) status: CreationOptional<'PENDING' | 'SUCCESS' | 'FAILED'>;
  @Column(DataType.SMALLINT) attempts: CreationOptional<number>;
  @Column(DataType.SMALLINT) responseStatus: CreationOptional<number | null>;
  @Column(DataType.STRING(1000)) responseBody: CreationOptional<string | null>;
  @Column(DataType.STRING(500)) error: CreationOptional<string | null>;
  @Column(DataType.DATE) deliveredAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;

  @BelongsTo(() => WebhookEndpoint, 'endpointId') endpoint?: NonAttribute<WebhookEndpoint>;
}
