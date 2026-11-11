import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import type { Transaction } from 'sequelize';
import { categoryOf, EMAIL_CATEGORIES, WHATSAPP_NUMBER_PATTERN, wantsWhatsApp, type NotificationSettings } from '../../contracts';
import { AppError } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { User } from '../../database/models';
import { sha256 } from '../../infrastructure/crypto/tokens';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';

export const WHATSAPP_JOB = 'notifications.whatsapp';
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
/** Codes sent to one person per hour (WhatsApp charges per message; also limits abuse of someone else's number). */
const MAX_CODES_PER_HOUR = 3;
/** Case details never leave the app. */
const DISCREET = new Set(['grievance']);

export interface WhatsAppMessage {
  to: string;
  template: string;
  params: string[];
}
export type WhatsAppSender = (message: WhatsAppMessage) => Promise<void>;

/**
 * WhatsApp notifications through the WhatsApp Business Cloud API. A person adds their number and confirms it with a
 * code sent there; notifications in the categories they get by email are then also sent as a template message (title
 * and link only; grievance updates carry no details), through the job queue so they go out only if the change commits.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);
  /** Replaced in tests. */
  sender: WhatsAppSender = (m) => this.send(m);

  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly jobs?: JobQueueService,
  ) {}

  onModuleInit(): void {
    this.jobs?.register<WhatsAppMessage>(WHATSAPP_JOB, (m) => this.sender(m));
  }

  get enabled(): boolean {
    return this.config.get('WHATSAPP_PROVIDER') !== 'off';
  }

  /** Sends a code to the number; it becomes the person's WhatsApp number once they enter the code. */
  async startVerification(userId: string, number: string): Promise<{ pendingNumber: string; expiresAt: string }> {
    if (!this.enabled) throw AppError.conflict('WhatsApp messages are not set up on this server');
    const normalized = number.replace(/[\s()-]/g, '');
    if (!WHATSAPP_NUMBER_PATTERN.test(normalized)) throw AppError.validation([{ field: 'number', message: 'Enter the number with country code, e.g. +91 98765 43210' }]);
    const user = await this.user(userId);
    const settings = user.notificationSettings ?? {};
    const hourAgo = Date.now() - 3_600_000;
    const recent = (settings.whatsappPending?.sentAt ?? []).filter((t) => Date.parse(t) > hourAgo);
    if (recent.length >= MAX_CODES_PER_HOUR) throw new AppError('RATE_LIMITED', 'Too many codes requested; try again in an hour');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    // Sent straight away rather than through the job queue, so the code isn't stored in a job row.
    await this.sender({ to: normalized, template: this.config.get('WHATSAPP_CODE_TEMPLATE'), params: [code] });
    await this.save(user, { ...settings, whatsappPending: { number: normalized, codeHash: sha256(code), expiresAt, attempts: 0, sentAt: [...recent, new Date().toISOString()] } });
    return { pendingNumber: normalized, expiresAt };
  }

  async confirm(userId: string, code: string): Promise<void> {
    const user = await this.user(userId);
    const settings = user.notificationSettings ?? {};
    const pending = settings.whatsappPending;
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) throw AppError.conflict('The code has expired; send a new one');
    if (pending.attempts >= MAX_ATTEMPTS) throw AppError.conflict('Too many wrong codes; send a new one');
    const ok = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(pending.codeHash));
    if (!ok) {
      await this.save(user, { ...settings, whatsappPending: { ...pending, attempts: pending.attempts + 1 } });
      throw AppError.validation([{ field: 'code', message: 'That code is not right' }]);
    }
    await this.save(user, { ...settings, whatsapp: true, whatsappNumber: pending.number, whatsappVerifiedAt: new Date().toISOString(), whatsappPending: { ...pending, codeHash: '', attempts: MAX_ATTEMPTS } });
  }

  async remove(userId: string): Promise<void> {
    const user = await this.user(userId);
    const { whatsappPending: _p, ...rest } = user.notificationSettings ?? {};
    await this.save(user, { ...rest, whatsapp: false, whatsappNumber: null, whatsappVerifiedAt: null });
  }

  /** Queued with the notification (sent only if the change commits). */
  async queue(userId: string, input: { type: string; title: string; link?: string }, transaction?: Transaction): Promise<void> {
    if (!this.enabled || !this.jobs) return;
    const category = EMAIL_CATEGORIES.find((c) => c.key === categoryOf(input.type));
    if (!category) return;
    const user = await User.findByPk(userId, { attributes: ['status', 'notificationSettings'], transaction });
    if (!user || user.status !== 'ACTIVE' || !wantsWhatsApp(user.notificationSettings, input.type)) return;
    const title = DISCREET.has(category.key) ? `There's an update on a ${category.label.toLowerCase().replace(/s$/, '')} case` : input.title.slice(0, 200);
    const link = `${this.config.get('APP_URL')}${input.link ?? '/me/notifications'}`;
    await this.jobs.enqueue(WHATSAPP_JOB, { to: user.notificationSettings!.whatsappNumber!, template: this.config.get('WHATSAPP_TEMPLATE'), params: [title, link] } satisfies WhatsAppMessage, { transaction, organizationId: null, maxAttempts: 3 });
  }

  private async send(m: WhatsAppMessage): Promise<void> {
    if (this.config.get('WHATSAPP_PROVIDER') === 'log') {
      this.logger.log(`WhatsApp to ${m.to.slice(0, -4).replace(/\d/g, '•')}${m.to.slice(-4)}: ${m.template} (${m.params.length} parameters)`);
      return;
    }
    const res = await fetch(`${this.config.get('WHATSAPP_API_URL')}/${this.config.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.get('WHATSAPP_TOKEN')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: m.to.replace(/^\+/, ''),
        type: 'template',
        template: { name: m.template, language: { code: this.config.get('WHATSAPP_TEMPLATE_LANGUAGE') }, components: [{ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) }] },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`WhatsApp API answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  private async user(userId: string): Promise<User> {
    const user = await User.findByPk(userId, { attributes: ['id', 'notificationSettings'] });
    if (!user) throw AppError.notFound('User');
    return user;
  }

  private async save(user: User, settings: NotificationSettings): Promise<void> {
    await User.update({ notificationSettings: settings }, { where: { id: user.id } });
  }
}
