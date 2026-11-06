import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import { Op, type Transaction } from 'sequelize';
import { AppConfig } from '../../config/app-config.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { MfaRecoveryCode, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { PasswordHasher } from '../../infrastructure/crypto/password-hasher.service';
import { generateRecoveryCode, normalizeRecoveryCode, sha256 } from '../../infrastructure/crypto/tokens';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityPolicyService } from './security-policy.service';

const RECOVERY_CODE_COUNT = 10;
const STEP_SECONDS = 30;

authenticator.options = { window: 1, step: STEP_SECONDS };

function loadUser(userId: string): Promise<User> {
  return User.scope('withSecrets').findByPk(userId, { rejectOnEmpty: true });
}

@Injectable()
export class MfaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryption: EncryptionService,
    private readonly hasher: PasswordHasher,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly policies: SecurityPolicyService,
    private readonly notifications: NotificationsService,
  ) {}

  async beginSetup(userId: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await loadUser(userId);
    if (user.mfaEnabled) throw AppError.conflict('MFA is already enabled');
    const secret = authenticator.generateSecret(20);
    await user.update({ mfaPendingSecretEnc: this.encryption.encrypt(secret) });
    const otpauthUrl = authenticator.keyuri(user.email, this.config.get('MFA_ISSUER'), secret);
    return { secret, otpauthUrl, qrCodeDataUrl: await toDataURL(otpauthUrl) };
  }

  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await loadUser(userId);
    if (user.mfaEnabled) throw AppError.conflict('MFA is already enabled');
    if (!user.mfaPendingSecretEnc) throw AppError.badRequest('Start MFA setup first');

    const step = this.matchStep(code, this.encryption.decrypt(user.mfaPendingSecretEnc));
    if (step === null) throw new AppError('MFA_INVALID', 'Invalid verification code');

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await this.db.transaction(async (transaction) => {
      await user.update(
        { mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaLastUsedStep: step },
        { transaction },
      );
      await this.replaceRecoveryCodes(userId, recoveryCodes, transaction);
      await this.audit.record({ action: 'auth.mfa_enabled', entityType: 'User', entityId: userId, summary: 'MFA enabled' }, transaction);
    });
    await this.notifications.notify(userId, { type: 'security', title: 'Two-factor authentication enabled', link: '/me/security' });
    return { recoveryCodes };
  }

  async disable(userId: string, password: string, code: string): Promise<void> {
    const user = await loadUser(userId);
    if (!user.mfaEnabled) throw AppError.badRequest('MFA is not enabled');
    const policy = await this.policies.forUser(userId);
    if (policy.mfaRequired) throw AppError.forbidden('Your organization requires two-factor authentication');
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    if (!(await this.verifyAndConsume(user, code))) throw new AppError('MFA_INVALID', 'Invalid verification code');

    await this.db.transaction(async (transaction) => {
      await User.update(
        { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastUsedStep: null },
        { where: { id: userId }, transaction },
      );
      await MfaRecoveryCode.destroy({ where: { userId }, transaction });
      await this.audit.record({ action: 'auth.mfa_disabled', entityType: 'User', entityId: userId, summary: 'MFA disabled' }, transaction);
    });
    await this.notifications.notify(userId, { type: 'security', title: 'Two-factor authentication disabled', link: '/me/security' });
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await loadUser(userId);
    if (!user.mfaEnabled) throw AppError.badRequest('MFA is not enabled');
    if (!(await this.verifyAndConsume(user, code))) throw new AppError('MFA_INVALID', 'Invalid verification code');
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await this.db.transaction((transaction) => this.replaceRecoveryCodes(userId, recoveryCodes, transaction));
    await this.audit.record({ action: 'auth.mfa_recovery_codes_regenerated', entityType: 'User', entityId: userId });
    return { recoveryCodes };
  }

  async status(userId: string): Promise<{ enabled: boolean; required: boolean; recoveryCodesRemaining: number }> {
    const user = await User.findByPk(userId, { attributes: ['mfaEnabled'], rejectOnEmpty: true });
    const policy = await this.policies.forUser(userId);
    return {
      enabled: user.mfaEnabled,
      required: policy.mfaRequired,
      recoveryCodesRemaining: user.mfaEnabled ? await MfaRecoveryCode.count({ where: { userId, usedAt: null } }) : 0,
    };
  }

  /** Verifies a TOTP code (rejecting replays of an already-used time-step) and records the step. */
  async verifyAndConsume(user: Pick<User, 'id' | 'mfaSecretEnc' | 'mfaLastUsedStep'>, code: string): Promise<boolean> {
    if (!user.mfaSecretEnc) return false;
    const step = this.matchStep(code, this.encryption.decrypt(user.mfaSecretEnc));
    if (step === null) return false;
    if (user.mfaLastUsedStep !== null && step <= user.mfaLastUsedStep) return false;
    const [updated] = await User.update(
      { mfaLastUsedStep: step },
      { where: { id: user.id, [Op.or]: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { [Op.lt]: step } }] } },
    );
    return updated === 1;
  }

  /** Consumes a single-use recovery code. */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const [updated] = await MfaRecoveryCode.update(
      { usedAt: new Date() },
      { where: { userId, codeHash: sha256(normalizeRecoveryCode(code)), usedAt: null } },
    );
    return updated === 1;
  }

  private async replaceRecoveryCodes(userId: string, codes: string[], transaction: Transaction): Promise<void> {
    await MfaRecoveryCode.destroy({ where: { userId }, transaction });
    await MfaRecoveryCode.bulkCreate(codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })), { transaction });
  }

  private matchStep(code: string, secret: string): number | null {
    const token = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) return null;
    const delta = authenticator.checkDelta(token, secret);
    if (delta === null) return null;
    return Math.floor(Date.now() / 1000 / STEP_SECONDS) + delta;
  }
}
