import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { AllowNull, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { User } from './identity.models';

/** A browser a person turned Web Push notifications on for (personal, visible in every organization). */
@Table({ tableName: 'push_subscriptions', underscored: true })
export class PushSubscription extends Model<InferAttributes<PushSubscription>, InferCreationAttributes<PushSubscription>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => User) @Column(DataType.UUID) userId: string;
  @Column(DataType.STRING(1000)) endpoint: string;
  @Column(DataType.STRING(200)) p256dh: string;
  @Column(DataType.STRING(100)) auth: string;
  @Column(DataType.STRING(300)) userAgent: CreationOptional<string | null>;
  @Column(DataType.DATE) lastSentAt: CreationOptional<Date | null>;
  @Column(DataType.SMALLINT) failureCount: CreationOptional<number>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** An installation of the HRMS phone app a person signed in on (Firebase Cloud Messaging token). */
@Table({ tableName: 'native_push_tokens', underscored: true })
export class NativePushToken extends Model<InferAttributes<NativePushToken>, InferCreationAttributes<NativePushToken>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => User) @Column(DataType.UUID) userId: string;
  @Column(DataType.STRING(8)) platform: 'ANDROID' | 'IOS';
  @Column(DataType.STRING(4096)) token: string;
  @Column(DataType.STRING(120)) deviceName: CreationOptional<string | null>;
  @Column(DataType.STRING(30)) appVersion: CreationOptional<string | null>;
  @Column(DataType.DATE) lastSentAt: CreationOptional<Date | null>;
  @Column(DataType.SMALLINT) failureCount: CreationOptional<number>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}
