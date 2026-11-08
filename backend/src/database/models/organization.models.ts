import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, HasOne, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { MembershipStatus, OrganizationStatus } from '../../contracts';
import { User } from './identity.models';
import { MembershipRole } from './rbac.models';

/** Entitlement catalog (one per product module). Synced from src/contracts on boot. */
@Table({ tableName: 'features', underscored: true })
export class Feature extends Model<InferAttributes<Feature>, InferCreationAttributes<Feature>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @Column(DataType.STRING(50))
  key: string;

  @Column(DataType.STRING(100))
  name: string;

  @Column(DataType.STRING(500))
  description: CreationOptional<string | null>;

  @Column(DataType.BOOLEAN)
  isCore: CreationOptional<boolean>;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @UpdatedAt
  updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'plans', underscored: true })
export class Plan extends Model<InferAttributes<Plan>, InferCreationAttributes<Plan>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @Column(DataType.STRING(50))
  code: string;

  @Column(DataType.STRING(100))
  name: string;

  @Column(DataType.STRING(500))
  description: CreationOptional<string | null>;

  @Column(DataType.BOOLEAN)
  isActive: CreationOptional<boolean>;

  /** Null = unlimited. */
  @Column(DataType.INTEGER)
  maxUsers: CreationOptional<number | null>;

  /** DECIMAL(12,2) – returned by pg as a string. */
  @Column(DataType.DECIMAL(12, 2))
  monthlyPrice: CreationOptional<string | number | null>;

  @Column(DataType.CHAR(3))
  currency: CreationOptional<string>;

  @Column(DataType.INTEGER)
  sortOrder: CreationOptional<number>;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @UpdatedAt
  updatedAt: CreationOptional<Date>;

  @Column(DataType.UUID)
  createdById: CreationOptional<string | null>;

  @Column(DataType.UUID)
  updatedById: CreationOptional<string | null>;

  @HasMany(() => PlanFeature, 'planId')
  features?: NonAttribute<PlanFeature[]>;

  @HasMany(() => Organization, 'planId')
  organizations?: NonAttribute<Organization[]>;
}

@Table({ tableName: 'plan_features', underscored: true, updatedAt: false })
export class PlanFeature extends Model<InferAttributes<PlanFeature>, InferCreationAttributes<PlanFeature>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => Plan) @Column(DataType.UUID)
  planId: string;

  @ForeignKey(() => Feature) @Column(DataType.UUID)
  featureId: string;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @BelongsTo(() => Feature, 'featureId')
  feature?: NonAttribute<Feature>;
}

@Table({ tableName: 'organizations', underscored: true })
export class Organization extends Model<InferAttributes<Organization>, InferCreationAttributes<Organization>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @Column(DataType.STRING(200)) name: string;
  @Column(DataType.STRING(200)) legalName: CreationOptional<string | null>;
  /** URL-safe unique identifier. */
  @Column(DataType.STRING(63)) slug: string;
  @Column(DataType.STRING) status: CreationOptional<OrganizationStatus>;

  @ForeignKey(() => Plan) @Column(DataType.UUID)
  planId: string;

  @Column(DataType.STRING(100)) industry: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) companySize: CreationOptional<string | null>;
  @Column(DataType.STRING(254)) email: CreationOptional<string | null>;
  @Column(DataType.STRING(30)) phone: CreationOptional<string | null>;
  @Column(DataType.STRING(255)) website: CreationOptional<string | null>;
  @Column(DataType.STRING(50)) registrationNumber: CreationOptional<string | null>;
  @Column(DataType.STRING(50)) taxId: CreationOptional<string | null>;
  @Column({ type: DataType.STRING(200), field: 'address_line1' }) addressLine1: CreationOptional<string | null>;
  @Column({ type: DataType.STRING(200), field: 'address_line2' }) addressLine2: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) city: CreationOptional<string | null>;
  @Column(DataType.STRING(100)) state: CreationOptional<string | null>;
  @Column(DataType.STRING(20)) postalCode: CreationOptional<string | null>;
  /** ISO 3166-1 alpha-2. */
  @Column(DataType.CHAR(2)) country: CreationOptional<string>;
  @Column(DataType.STRING(64)) timezone: CreationOptional<string>;
  /** ISO 4217. */
  @Column(DataType.CHAR(3)) currency: CreationOptional<string>;
  @Column(DataType.STRING(10)) locale: CreationOptional<string>;
  @Column(DataType.STRING(20)) dateFormat: CreationOptional<string>;
  @Column(DataType.SMALLINT) fiscalYearStartMonth: CreationOptional<number>;
  /** First month of the leave year (1 = January). */
  @Column(DataType.SMALLINT) leaveYearStartMonth: CreationOptional<number>;
  @Column(DataType.STRING(500)) logoUrl: CreationOptional<string | null>;
  /** Lowercase `#rrggbb`; the web app derives an accessible palette from it. */
  @Column(DataType.STRING(7)) brandColor: CreationOptional<string | null>;
  @Column(DataType.DATE) activatedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) suspendedAt: CreationOptional<Date | null>;
  @Column(DataType.STRING(500)) suspensionReason: CreationOptional<string | null>;

  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Plan, 'planId')
  plan?: NonAttribute<Plan>;

  @HasOne(() => OrganizationSecurityPolicy, 'organizationId')
  securityPolicy?: NonAttribute<OrganizationSecurityPolicy>;

  @HasMany(() => OrganizationFeature, 'organizationId')
  features?: NonAttribute<OrganizationFeature[]>;

  @HasMany(() => OrganizationMembership, 'organizationId')
  memberships?: NonAttribute<OrganizationMembership[]>;
}

/** Organization logo image; `organizations.logo_url` points at the versioned public URL for it. */
@Table({ tableName: 'organization_logos', underscored: true })
export class OrganizationLogo extends Model<InferAttributes<OrganizationLogo>, InferCreationAttributes<OrganizationLogo>> {
  @PrimaryKey @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: string;

  @Column(DataType.STRING(50)) contentType: string;
  @Column(DataType.BLOB) data: Buffer;
  @Column(DataType.INTEGER) byteSize: number;
  /** SHA-256 hex of `data`; used as the cache-busting version and ETag. */
  @Column(DataType.CHAR(64)) checksum: string;

  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

/** Per-organization entitlement overrides on top of the plan (enable or disable a module). */
@Table({ tableName: 'organization_features', underscored: true })
export class OrganizationFeature extends Model<InferAttributes<OrganizationFeature>, InferCreationAttributes<OrganizationFeature>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: string;

  @ForeignKey(() => Feature) @Column(DataType.UUID)
  featureId: string;

  @Column(DataType.BOOLEAN) enabled: boolean;
  @Column(DataType.STRING(500)) reason: CreationOptional<string | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Feature, 'featureId')
  feature?: NonAttribute<Feature>;
}

@Table({ tableName: 'organization_security_policies', underscored: true })
export class OrganizationSecurityPolicy extends Model<InferAttributes<OrganizationSecurityPolicy>, InferCreationAttributes<OrganizationSecurityPolicy>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: string;

  @Column(DataType.SMALLINT) passwordMinLength: CreationOptional<number>;
  @Column(DataType.BOOLEAN) passwordRequireUppercase: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) passwordRequireLowercase: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) passwordRequireNumber: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) passwordRequireSymbol: CreationOptional<boolean>;
  @Column(DataType.SMALLINT) passwordHistoryCount: CreationOptional<number>;
  /** 0 = passwords never expire. */
  @Column(DataType.SMALLINT) passwordMaxAgeDays: CreationOptional<number>;
  @Column(DataType.SMALLINT) lockoutThreshold: CreationOptional<number>;
  @Column(DataType.SMALLINT) lockoutDurationMinutes: CreationOptional<number>;
  @Column(DataType.INTEGER) sessionIdleTimeoutMinutes: CreationOptional<number>;
  @Column(DataType.INTEGER) sessionMaxLifetimeHours: CreationOptional<number>;
  @Column(DataType.BOOLEAN) mfaRequired: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;
}

@Table({ tableName: 'organization_memberships', underscored: true })
export class OrganizationMembership extends Model<InferAttributes<OrganizationMembership>, InferCreationAttributes<OrganizationMembership>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: string;

  @ForeignKey(() => User) @Column(DataType.UUID)
  userId: string;

  @Column(DataType.STRING) status: CreationOptional<MembershipStatus>;
  @Column(DataType.DATE) invitedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) joinedAt: CreationOptional<Date | null>;
  @Column(DataType.DATE) suspendedAt: CreationOptional<Date | null>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @BelongsTo(() => Organization, 'organizationId')
  organization?: NonAttribute<Organization>;

  @BelongsTo(() => User, 'userId')
  user?: NonAttribute<User>;

  @HasMany(() => MembershipRole, 'membershipId')
  roles?: NonAttribute<MembershipRole[]>;
}
