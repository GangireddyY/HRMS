import { Injectable, Logger } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import { AppConfig } from '../../config/app-config.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Organization, RefreshToken, UserSession } from '../../database/models';
import { generateToken, sha256 } from '../../infrastructure/crypto/tokens';
import { AuditService } from '../../infrastructure/audit/audit.service';

export interface SessionLimits {
  idleTimeoutMinutes: number;
  maxLifetimeHours: number;
}

export interface CreatedSession {
  session: UserSession;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const MINUTE = 60_000;

/**
 * Sessions and rotating refresh tokens.
 * - Each refresh returns a new token and marks the old one used.
 * - Re-presenting a used token (replay / theft) revokes the entire session.
 * - Refresh tokens expire after the idle timeout; sessions expire after the absolute lifetime.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  private absoluteLifetimeMs(limits: SessionLimits): number {
    const capHours = this.config.get('REFRESH_TOKEN_TTL_DAYS') * 24;
    return Math.min(limits.maxLifetimeHours, capHours) * 60 * MINUTE;
  }

  async create(input: {
    userId: string;
    organizationId: string | null;
    ipAddress?: string;
    userAgent?: string;
    mfaVerified: boolean;
    limits: SessionLimits;
  }): Promise<CreatedSession> {
    const now = Date.now();
    const expiresAt = new Date(now + this.absoluteLifetimeMs(input.limits));
    const refreshToken = generateToken();
    const refreshExpiresAt = new Date(Math.min(now + input.limits.idleTimeoutMinutes * MINUTE, expiresAt.getTime()));

    const session = await this.db.transaction(async (transaction) => {
      const created = await UserSession.create(
        {
          userId: input.userId,
          organizationId: input.organizationId,
          ipAddress: input.ipAddress?.slice(0, 64) ?? null,
          userAgent: input.userAgent?.slice(0, 512) ?? null,
          mfaVerified: input.mfaVerified,
          expiresAt,
        },
        { transaction },
      );
      await RefreshToken.create({ sessionId: created.id, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt }, { transaction });
      return created;
    });
    return { session, refreshToken, refreshExpiresAt };
  }

  /** Rotates a refresh token. Returns the session and a new refresh token. */
  async rotate(rawToken: string, limits: (organizationId: string | null) => Promise<SessionLimits>): Promise<CreatedSession> {
    const record = await RefreshToken.findOne({ where: { tokenHash: sha256(rawToken) }, include: [UserSession] });
    if (!record?.session) throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');

    const { session } = record;
    const now = new Date();

    if (record.usedAt) {
      await this.revoke(session.id, 'refresh_token_reuse');
      this.logger.warn(`Refresh token reuse detected for session ${session.id}; session revoked`);
      await this.audit.record({
        action: 'auth.refresh_token_reuse',
        entityType: 'UserSession',
        entityId: session.id,
        summary: 'Refresh token replay detected; session revoked',
        actorUserId: session.userId,
        organizationId: session.organizationId,
      });
      throw new AppError('SESSION_REVOKED', 'Session revoked. Please sign in again.');
    }
    if (session.revokedAt) throw new AppError('SESSION_REVOKED', 'Session revoked. Please sign in again.');
    if (record.expiresAt <= now || session.expiresAt <= now) {
      throw new AppError('TOKEN_EXPIRED', 'Session expired. Please sign in again.');
    }

    const sessionLimits = await limits(session.organizationId);
    const refreshToken = generateToken();
    const refreshExpiresAt = new Date(Math.min(now.getTime() + sessionLimits.idleTimeoutMinutes * MINUTE, session.expiresAt.getTime()));

    // Conditional update guarantees only one concurrent rotation wins.
    const rotated = await this.db.transaction(async (transaction) => {
      const [claimed] = await RefreshToken.update({ usedAt: now }, { where: { id: record.id, usedAt: null }, transaction });
      if (claimed !== 1) return false;
      await RefreshToken.create({ sessionId: session.id, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt }, { transaction });
      await session.update({ lastActiveAt: now }, { transaction });
      return true;
    });
    if (!rotated) throw new AppError('SESSION_REVOKED', 'Session revoked. Please sign in again.');

    return { session, refreshToken, refreshExpiresAt };
  }

  async revoke(sessionId: string, reason: string, transaction?: Transaction): Promise<void> {
    await UserSession.update({ revokedAt: new Date(), revokedReason: reason }, { where: { id: sessionId, revokedAt: null }, transaction });
  }

  /** Revokes sessions for a user, optionally keeping one and/or limiting to one organization. */
  async revokeAll(
    userId: string,
    reason: string,
    opts: { exceptSessionId?: string; organizationId?: string } = {},
    transaction?: Transaction,
  ): Promise<number> {
    const [count] = await UserSession.update(
      { revokedAt: new Date(), revokedReason: reason },
      {
        where: {
          userId,
          revokedAt: null,
          ...(opts.exceptSessionId ? { id: { [Op.ne]: opts.exceptSessionId } } : {}),
          ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        },
        transaction,
      },
    );
    return count;
  }

  async revokeAllInOrganization(organizationId: string, reason: string): Promise<number> {
    const [count] = await UserSession.update({ revokedAt: new Date(), revokedReason: reason }, { where: { organizationId, revokedAt: null } });
    return count;
  }

  listActive(userId: string) {
    return UserSession.findAll({
      where: { userId, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
      order: [['lastActiveAt', 'DESC']],
      attributes: ['id', 'ipAddress', 'userAgent', 'createdAt', 'lastActiveAt', 'expiresAt', 'mfaVerified'],
      include: [{ model: Organization, attributes: ['id', 'name'] }],
    });
  }

  /** Throttled activity tracking (at most once per minute per session). */
  async touch(session: { id: string; lastActiveAt: Date }): Promise<void> {
    if (Date.now() - session.lastActiveAt.getTime() < MINUTE) return;
    await UserSession.update({ lastActiveAt: new Date() }, { where: { id: session.id } });
  }
}
