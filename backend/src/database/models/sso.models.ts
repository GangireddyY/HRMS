import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { AllowNull, Column, CreatedAt, DataType, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

/** An organization's OpenID Connect identity provider. */
@Table({ tableName: 'organization_sso_configs', underscored: true })
export class OrganizationSsoConfig extends Model<InferAttributes<OrganizationSsoConfig>, InferCreationAttributes<OrganizationSsoConfig>> {
  @PrimaryKey @AllowNull(false) @Column(DataType.UUID) organizationId: string;
  @Column(DataType.BOOLEAN) enabled: CreationOptional<boolean>;
  @Column(DataType.STRING(500)) issuer: string;
  @Column(DataType.STRING(300)) clientId: string;
  @Column(DataType.TEXT) clientSecretEncrypted: CreationOptional<string | null>;
  @Column(DataType.ARRAY(DataType.STRING(253))) emailDomains: CreationOptional<string[]>;
  @Column(DataType.BOOLEAN) required: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) autoProvision: CreationOptional<boolean>;
  @Column(DataType.STRING(60)) defaultRoleKey: CreationOptional<string>;
  @Column(DataType.STRING(60)) buttonLabel: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

/** A sign-in waiting for the identity provider's answer (single use, 10 minutes). Not tenant-scoped: looked up by state. */
@Table({ tableName: 'sso_login_states', underscored: true, updatedAt: false })
export class SsoLoginState extends Model<InferAttributes<SsoLoginState>, InferCreationAttributes<SsoLoginState>> {
  @PrimaryKey @Column(DataType.CHAR(64)) id: string;
  @Column(DataType.UUID) organizationId: string;
  @Column(DataType.STRING(64)) nonce: string;
  @Column(DataType.STRING(128)) codeVerifier: string;
  @Column(DataType.STRING(300)) returnTo: CreationOptional<string | null>;
  @Column(DataType.DATE) expiresAt: Date;
  @CreatedAt createdAt: CreationOptional<Date>;
}
