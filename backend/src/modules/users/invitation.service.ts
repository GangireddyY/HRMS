import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { AppConfig } from '../../config/app-config.service';
import { AppError } from '../../common/errors/app-error';
import { ActionToken } from '../../database/models';
import { generateToken, sha256 } from '../../infrastructure/crypto/tokens';
import { MailService } from '../../infrastructure/mail/mail.service';
import { invitationEmail } from '../../infrastructure/mail/templates';

export const INVITATION_TTL_HOURS = 72;

/** Issues single-use invitation tokens and sends invitation emails. */
@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  /** Invalidates previous pending invitations for the same user/organization and returns a new raw token. */
  async issueToken(userId: string, organizationId: string, actorId: string | null, transaction?: Transaction): Promise<string> {
    const raw = generateToken();
    await this.revokePending(userId, organizationId, transaction);
    await ActionToken.create(
      {
        userId,
        organizationId,
        purpose: 'INVITATION',
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + INVITATION_TTL_HOURS * 3_600_000),
        createdById: actorId,
      },
      { transaction },
    );
    return raw;
  }

  async revokePending(userId: string, organizationId: string, transaction?: Transaction): Promise<void> {
    await ActionToken.update({ usedAt: new Date() }, { where: { userId, organizationId, purpose: 'INVITATION', usedAt: null }, transaction });
  }

  async send(input: { email: string; firstName: string; organizationName: string; inviterName: string; rawToken: string }): Promise<void> {
    const url = `${this.config.get('APP_URL')}/accept-invitation?token=${encodeURIComponent(input.rawToken)}`;
    try {
      await this.mail.send(invitationEmail(input.email, input.firstName, input.organizationName, input.inviterName, url, INVITATION_TTL_HOURS));
    } catch (e) {
      this.logger.error(`Failed to send invitation email to ${input.email}`, (e as Error).stack);
      throw AppError.badRequest('The invitation was created but the email could not be sent. Use "Resend invitation" to retry.');
    }
  }
}
