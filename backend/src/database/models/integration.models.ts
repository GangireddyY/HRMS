import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

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
