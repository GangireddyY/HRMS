import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Scopes, DefaultScope, Table, UpdatedAt } from 'sequelize-typescript';
import type { AppearancePreferences, NotificationSettings, PlatformRole, UserStatus } from '../../contracts';
import { Organization, OrganizationMembership } from './organization.models';

export type ActionTokenPurpose = 'PASSWORD_RESET' | 'INVITATION';
export type LoginOutcome = 'SUCCESS' | 'FAILURE' | 'MFA_CHALLENGE' | 'LOCKED';

/** Credentials and MFA secrets are excluded unless the `withSecrets` scope is requested explicitly. */
export const USER_SECRET_ATTRIBUTES = ['passwordHash', 'mfaSecretEnc', 'mfaPendingSecretEnc'] as const;

@DefaultScope(() => ({ attributes: { exclude: [...USER_SECRET_ATTRIBUTES] } }))
@Scopes(() => ({ withSecrets: {} }))
@Table({ tableName: 'users', underscored: true })
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @Column(DataType.STRING(254))
  email: string;

  /** Argon2id hash. Null until an invited user sets their password. */
  @Column(DataType.TEXT)
  passwordHash: CreationOptional<string | null>;

  @Column(DataType.STRING(100))
  firstName: string;

  @Column(DataType.STRING(100))
  lastName: string;

  @Column(DataType.STRING(30))
  phone: CreationOptional<string | null>;

  @Column(DataType.STRING)
  status: CreationOptional<UserStatus>;

  @Column(DataType.STRING)
  platformRole: CreationOptional<PlatformRole | null>;

  @Column(DataType.BOOLEAN)
  mfaEnabled: CreationOptional<boolean>;

  /** AES-256-GCM encrypted TOTP secret. */
  @Column(DataType.TEXT)
  mfaSecretEnc: CreationOptional<string | null>;

  @Column(DataType.TEXT)
  mfaPendingSecretEnc: CreationOptional<string | null>;

  @Column(DataType.DATE)
  mfaEnabledAt: CreationOptional<Date | null>;

  /** Last accepted TOTP time-step; prevents replay of a code within its validity window. */
  @Column(DataType.INTEGER)
  mfaLastUsedStep: CreationOptional<number | null>;

  @Column(DataType.INTEGER)
  failedLoginCount: CreationOptional<number>;

  @Column(DataType.DATE)
  lockedUntil: CreationOptional<Date | null>;

  @Column(DataType.DATE)
  passwordChangedAt: CreationOptional<Date | null>;

  @Column(DataType.DATE)
  lastLoginAt: CreationOptional<Date | null>;

  /** Versioned, API-relative URL of the profile photo (see UserAvatar). */
  @Column(DataType.STRING(200))
  avatarUrl: CreationOptional<string | null>;

  /** Appearance choices that follow the user across devices. */
  @Column(DataType.JSONB)
  preferences: CreationOptional<AppearancePreferences>;

  /** Which notifications are also emailed (see contracts/notifications). */
  @Column(DataType.JSONB)
  notificationSettings: CreationOptional<NotificationSettings>;

  @ForeignKey(() => Organization) @Column(DataType.UUID)
  lastOrganizationId: CreationOptional<string | null>;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @UpdatedAt
  updatedAt: CreationOptional<Date>;

  @Column(DataType.UUID)
  createdById: CreationOptional<string | null>;

  @Column(DataType.UUID)
  updatedById: CreationOptional<string | null>;

  @HasMany(() => OrganizationMembership, 'userId')
  memberships?: NonAttribute<OrganizationMembership[]>;
}

/** A user's profile photo (square WebP, re-encoded from the upload). */
@Table({ tableName: 'user_avatars', underscored: true })
export class UserAvatar extends Model<InferAttributes<UserAvatar>, InferCreationAttributes<UserAvatar>> {
  @PrimaryKey @ForeignKey(() => User) @Column(DataType.UUID)
  userId: string;

  @Column(DataType.STRING(50)) contentType: string;
  @Column(DataType.BLOB) data: Buffer;
  @Column(DataType.INTEGER) byteSize: number;
  /** SHA-256 hex of `data`; part of the URL (so it can't be guessed from the user id) and the ETag. */
  @Column(DataType.CHAR(64)) checksum: string;

  @CreatedAt createdAt: CreationOptional<Date>;
  @UpdatedAt updatedAt: CreationOptional<Date>;
}

@Table({ tableName: 'password_history', underscored: true, updatedAt: false })
export class PasswordHistory extends Model<InferAttributes<PasswordHistory>, InferCreationAttributes<PasswordHistory>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => User) @Column(DataType.UUID)
  userId: string;

  @Column(DataType.TEXT)
  passwordHash: string;

  @CreatedAt
  createdAt: CreationOptional<Date>;
}

@Table({ tableName: 'mfa_recovery_codes', underscored: true, updatedAt: false })
export class MfaRecoveryCode extends Model<InferAttributes<MfaRecoveryCode>, InferCreationAttributes<MfaRecoveryCode>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => User) @Column(DataType.UUID)
  userId: string;

  /** SHA-256 of the normalised recovery code. */
  @Column(DataType.CHAR(64))
  codeHash: string;

  @Column(DataType.DATE)
  usedAt: CreationOptional<Date | null>;

  @CreatedAt
  createdAt: CreationOptional<Date>;
}

/** One row per sign-in (device). Refresh tokens rotate within a session. */
@Table({ tableName: 'user_sessions', underscored: true, updatedAt: false })
export class UserSession extends Model<InferAttributes<UserSession>, InferCreationAttributes<UserSession>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => User) @Column(DataType.UUID)
  userId: string;

  /** Organization the session is currently operating in (null for platform-only sessions). */
  @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: string | null;

  @Column(DataType.STRING(64))
  ipAddress: CreationOptional<string | null>;

  @Column(DataType.STRING(512))
  userAgent: CreationOptional<string | null>;

  @Column(DataType.BOOLEAN)
  mfaVerified: CreationOptional<boolean>;

  /** When the user last re-confirmed their identity (MFA code or password) for a sensitive action. */
  @Column(DataType.DATE)
  stepUpAt: CreationOptional<Date | null>;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @Default(DataType.NOW) @Column(DataType.DATE)
  lastActiveAt: CreationOptional<Date>;

  /** Absolute lifetime limit. */
  @Column(DataType.DATE)
  expiresAt: Date;

  @Column(DataType.DATE)
  revokedAt: CreationOptional<Date | null>;

  @Column(DataType.STRING(50))
  revokedReason: CreationOptional<string | null>;

  @BelongsTo(() => User, 'userId')
  user?: NonAttribute<User>;

  @BelongsTo(() => Organization, 'organizationId')
  organization?: NonAttribute<Organization | null>;

  @HasMany(() => RefreshToken, 'sessionId')
  refreshTokens?: NonAttribute<RefreshToken[]>;
}

@Table({ tableName: 'refresh_tokens', underscored: true, updatedAt: false })
export class RefreshToken extends Model<InferAttributes<RefreshToken>, InferCreationAttributes<RefreshToken>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => UserSession) @Column(DataType.UUID)
  sessionId: string;

  /** SHA-256 of the opaque token. The raw token only ever lives in an HttpOnly cookie. */
  @Column(DataType.CHAR(64))
  tokenHash: string;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @Column(DataType.DATE)
  expiresAt: Date;

  /** Set when rotated. Presenting a used token again is treated as theft and revokes the session. */
  @Column(DataType.DATE)
  usedAt: CreationOptional<Date | null>;

  @BelongsTo(() => UserSession, 'sessionId')
  session?: NonAttribute<UserSession>;
}

/** Single-use tokens for password reset and invitations (stored hashed). */
@Table({ tableName: 'action_tokens', underscored: true, updatedAt: false })
export class ActionToken extends Model<InferAttributes<ActionToken>, InferCreationAttributes<ActionToken>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => User) @Column(DataType.UUID)
  userId: string;

  @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: CreationOptional<string | null>;

  @Column(DataType.STRING)
  purpose: ActionTokenPurpose;

  @Column(DataType.CHAR(64))
  tokenHash: string;

  @Column(DataType.DATE)
  expiresAt: Date;

  @Column(DataType.DATE)
  usedAt: CreationOptional<Date | null>;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @Column(DataType.UUID)
  createdById: CreationOptional<string | null>;

  @BelongsTo(() => User, 'userId')
  user?: NonAttribute<User>;

  @BelongsTo(() => Organization, 'organizationId')
  organization?: NonAttribute<Organization | null>;
}

@Table({ tableName: 'login_events', underscored: true, updatedAt: false })
export class LoginEvent extends Model<InferAttributes<LoginEvent>, InferCreationAttributes<LoginEvent>> {
  @PrimaryKey @Default(DataType.UUIDV4) @Column(DataType.UUID)
  id: CreationOptional<string>;

  @ForeignKey(() => User) @Column(DataType.UUID)
  userId: CreationOptional<string | null>;

  @ForeignKey(() => Organization) @Column(DataType.UUID)
  organizationId: CreationOptional<string | null>;

  @Column(DataType.STRING(254))
  email: string;

  @Column(DataType.STRING)
  outcome: LoginOutcome;

  @Column(DataType.STRING(50))
  failureReason: CreationOptional<string | null>;

  @Column(DataType.STRING(64))
  ipAddress: CreationOptional<string | null>;

  @Column(DataType.STRING(512))
  userAgent: CreationOptional<string | null>;

  @CreatedAt
  createdAt: CreationOptional<Date>;

  @BelongsTo(() => User, 'userId')
  user?: NonAttribute<User | null>;

  @BelongsTo(() => Organization, 'organizationId')
  organization?: NonAttribute<Organization | null>;
}
