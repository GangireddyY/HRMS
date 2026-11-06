import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AllowNull, BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import type { PermissionScope } from '../../contracts';
import { Organization, OrganizationMembership } from './organization.models';

/** Global permission catalog (synced from src/contracts). */
@Table({ tableName: 'permissions', underscored: true })
export class Permission extends Model<InferAttributes<Permission>, InferCreationAttributes<Permission>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @Column(DataType.STRING(100)) key: string;
  @Column(DataType.STRING(50)) module: string;
  @Column(DataType.STRING(100)) page: string;
  @Column(DataType.STRING(255)) description: string;
  @Column(DataType.BOOLEAN) isScopable: CreationOptional<boolean>;
  @Column(DataType.BOOLEAN) isRestricted: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'roles', underscored: true })
export class Role extends Model<InferAttributes<Role>, InferCreationAttributes<Role>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: string;

  @Column(DataType.STRING(60)) key: string;
  @Column(DataType.STRING(100)) name: string;
  @Column(DataType.STRING(500)) description: CreationOptional<string | null>;
  /** Provisioned from a system template. */
  @Column(DataType.BOOLEAN) isSystem: CreationOptional<boolean>;
  /** Permissions cannot be edited. */
  @Column(DataType.BOOLEAN) isLocked: CreationOptional<boolean>;
  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
  @Column(DataType.UUID) createdById: CreationOptional<string | null>;
  @Column(DataType.UUID) updatedById: CreationOptional<string | null>;

  @HasMany(() => RolePermission, 'roleId')
  permissions?: NonAttribute<RolePermission[]>;

  @HasMany(() => MembershipRole, 'roleId')
  members?: NonAttribute<MembershipRole[]>;
}

/** The (role_id, organization_id) composite FK guarantees the row belongs to the role's organization. */
@Table({ tableName: 'role_permissions', underscored: true, updatedAt: false })
export class RolePermission extends Model<InferAttributes<RolePermission>, InferCreationAttributes<RolePermission>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;

  @ForeignKey(() => Role) @Column(DataType.UUID)
  roleId: string;

  @ForeignKey(() => Permission) @Column(DataType.UUID)
  permissionId: string;

  @Column(DataType.STRING) scope: CreationOptional<PermissionScope>;
  @CreatedAt createdAt: CreationOptional<Date>;

  @BelongsTo(() => Permission, 'permissionId')
  permission?: NonAttribute<Permission>;
}

/** Composite FKs make cross-tenant role assignment impossible at the database level. */
@Table({ tableName: 'membership_roles', underscored: true, createdAt: 'assignedAt', updatedAt: false })
export class MembershipRole extends Model<InferAttributes<MembershipRole>, InferCreationAttributes<MembershipRole>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @AllowNull(false) @Column(DataType.UUID) organizationId: string;

  @ForeignKey(() => OrganizationMembership) @Column(DataType.UUID)
  membershipId: string;

  @ForeignKey(() => Role) @Column(DataType.UUID)
  roleId: string;

  @CreatedAt assignedAt: CreationOptional<Date>;
  @Column(DataType.UUID) assignedById: CreationOptional<string | null>;

  @BelongsTo(() => Role, 'roleId')
  role?: NonAttribute<Role>;
}
