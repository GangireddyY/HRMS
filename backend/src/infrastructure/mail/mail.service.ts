import { Injectable, Logger } from '@nestjs/common';
import { MailService as SendGridClient } from '@sendgrid/mail';
import { AppConfig } from '../../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const SENDGRID_TIMEOUT_MS = 10_000;

/**
 * Outbound email through SendGrid (Web API v3).
 *  - SENDGRID_API_KEY set: messages are delivered by SendGrid (always the case in production).
 *  - Development without a key: messages are written to the API log.
 *  - Test: nothing is sent; messages are captured in `outbox` so integration tests can read links.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client?: SendGridClient;
  readonly outbox: MailMessage[] = [];

  constructor(private readonly config: AppConfig) {
    const apiKey = config.get('SENDGRID_API_KEY');
    if (apiKey && !config.isTest) {
      this.client = new SendGridClient();
      this.client.setApiKey(apiKey);
      this.client.setTimeout(SENDGRID_TIMEOUT_MS);
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (this.config.isTest) {
      this.outbox.push(message);
      return;
    }
    if (!this.client) {
      this.logger.warn(`SENDGRID_API_KEY not set – email to ${message.to} not sent.\nSubject: ${message.subject}\n${message.text}`);
      return;
    }
    try {
      await this.client.send({
        from: { email: this.config.get('SENDGRID_FROM_EMAIL'), name: this.config.get('SENDGRID_FROM_NAME') },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        // These emails carry one-time tokens (password reset, invitations); tracking would route them through SendGrid redirects.
        trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
        mailSettings: { sandboxMode: { enable: this.config.get('SENDGRID_SANDBOX_MODE') } },
      });
    } catch (err) {
      const reason = describeError(err);
      this.logger.error(`SendGrid could not send email (subject "${message.subject}"): ${reason}`);
      throw new Error(`Email delivery failed: ${reason}`);
    }
  }
}

/** SendGrid errors carry the HTTP status and API messages; never include credentials. */
function describeError(err: unknown): string {
  const e = err as { code?: number; message?: string; response?: { body?: { errors?: { message?: string }[] } } };
  const apiMessages = e.response?.body?.errors?.map((x) => x.message).filter(Boolean);
  if (apiMessages?.length) return `${e.code ?? 'error'} ${apiMessages.join('; ')}`;
  return e.message ?? String(err);
}
