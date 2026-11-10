import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Transaction } from 'sequelize';
import { WEBHOOK_EVENT_GROUPS, WEBHOOK_EXCLUDED_PREFIXES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ipAllowed } from '../../common/utils/networks';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import { AuditLog, WebhookDelivery, WebhookEndpoint } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { JobQueueService, type Job } from '../../infrastructure/jobs/job-queue.service';
import type { UpdateWebhookDto, WebhookDto } from './integrations.dto';

export const WEBHOOK_JOB = 'webhooks.deliver';
const MAX_ENDPOINTS = 20;
const DISABLE_AFTER_FAILURES = 25;
const CACHE_MS = 30_000;
const PRIVATE_NETWORKS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', '0.0.0.0/8', '::1/128', 'fc00::/7', 'fe80::/10'];
const CROSS_TENANT = { skipTenantScope: true } as const;

/** Whether an event (an audited action) matches the endpoint's patterns. */
export function matchesEvent(patterns: string[], event: string): boolean {
  if (WEBHOOK_EXCLUDED_PREFIXES.some((p) => event.startsWith(p))) return false;
  return patterns.some((p) => p === '*' || p === event || (p.endsWith('.*') && event.startsWith(p.slice(0, -1))));
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the endpoint secret>`. */
export function signature(secret: string, body: string, at = Math.floor(Date.now() / 1000)): string {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}

/**
 * Webhooks (`integration.manage`): the organization's audited events are delivered as signed JSON POSTs to the
 * endpoints subscribed to them. Deliveries are queued with the change (so nothing is sent if it rolls back), retried
 * with backoff, logged, and can be redelivered. An endpoint failing 25 times in a row is switched off. In production,
 * endpoints must use HTTPS and may not point at private networks.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly cache = new Map<string, { at: number; endpoints: { id: string; events: string[] }[] }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: EncryptionService,
    private readonly audit: AuditService,
    private readonly jobs: JobQueueService,
    private readonly config: AppConfig,
  ) {
    this.jobs.register<{ deliveryId: string }>(WEBHOOK_JOB, (payload, job) => this.deliver(payload.deliveryId, job));
    this.audit.subscribe((row, transaction) => this.dispatch(row, transaction));
  }

  catalog() {
    return { groups: WEBHOOK_EVENT_GROUPS.map((g) => ({ ...g, pattern: `${g.key}.*` })), excluded: WEBHOOK_EXCLUDED_PREFIXES };
  }

  // ---- Endpoints -------------------------------------------------------------------------------

  async list() {
    const rows = await WebhookEndpoint.findAll({ order: [['createdAt', 'ASC']] });
    return rows.map((e) => this.present(e));
  }

  async get(id: string) {
    const e = await this.find(id);
    const deliveries = await WebhookDelivery.findAll({ where: { endpointId: id }, order: [['createdAt', 'DESC']], limit: 50 });
    return { ...this.present(e), deliveries: deliveries.map((d) => this.presentDelivery(d)) };
  }

  async create(auth: AuthContext, dto: WebhookDto) {
    this.assertUrl(dto.url);
    if ((await WebhookEndpoint.count()) >= MAX_ENDPOINTS) throw AppError.conflict(`An organization can have up to ${MAX_ENDPOINTS} webhooks`);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const e = await this.db.transaction(async (transaction) => {
      const created = await WebhookEndpoint.create(
        { organizationId: auth.organizationId!, url: dto.url, description: dto.description ?? null, events: dto.events, secretEncrypted: 'pending', enabled: dto.enabled ?? true, createdById: auth.userId },
        { transaction },
      );
      await created.update({ secretEncrypted: this.crypto.encrypt(secret, fields.webhookSecret(created.id)) }, { transaction });
      await this.audit.record({ action: 'integration.webhook_created', entityType: 'WebhookEndpoint', entityId: created.id, summary: `Webhook to ${new URL(dto.url).host} created`, metadata: { url: dto.url, events: dto.events } }, transaction);
      return created;
    });
    this.cache.delete(auth.organizationId!);
    return { ...this.present(e), secret };
  }

  async update(auth: AuthContext, id: string, dto: UpdateWebhookDto) {
    const e = await this.find(id);
    if (dto.url) this.assertUrl(dto.url);
    await this.db.transaction(async (transaction) => {
      await e.update(
        {
          ...(dto.url ? { url: dto.url } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.events ? { events: dto.events } : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled, ...(dto.enabled ? { consecutiveFailures: 0, disabledReason: null } : {}) } : {}),
        },
        { transaction },
      );
      await this.audit.record({ action: 'integration.webhook_updated', entityType: 'WebhookEndpoint', entityId: id, summary: `Webhook to ${new URL(e.url).host} updated`, metadata: { ...dto } }, transaction);
    });
    this.cache.delete(auth.organizationId!);
    return this.get(id);
  }

  async remove(auth: AuthContext, id: string) {
    const e = await this.find(id);
    await this.db.transaction(async (transaction) => {
      await e.destroy({ transaction });
      await this.audit.record({ action: 'integration.webhook_deleted', entityType: 'WebhookEndpoint', entityId: id, summary: `Webhook to ${new URL(e.url).host} deleted` }, transaction);
    });
    this.cache.delete(auth.organizationId!);
    return { deleted: true };
  }

  async rotateSecret(auth: AuthContext, id: string) {
    const e = await this.find(id);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await this.db.transaction(async (transaction) => {
      await e.update({ secretEncrypted: this.crypto.encrypt(secret, fields.webhookSecret(e.id)) }, { transaction });
      await this.audit.record({ action: 'integration.webhook_secret_rotated', entityType: 'WebhookEndpoint', entityId: id, summary: `Signing secret of the webhook to ${new URL(e.url).host} rotated` }, transaction);
    });
    return { ...this.present(e), secret };
  }

  /** Sends a `ping` now and returns the result. */
  async test(auth: AuthContext, id: string) {
    const e = await this.find(id);
    const d = await WebhookDelivery.create({ organizationId: auth.organizationId!, endpointId: e.id, event: 'ping', payload: {} });
    await d.update({ payload: this.payload(d.id, 'ping', auth.organizationId!, { message: 'Test delivery from HRMS' }) });
    await this.attempt(d, e, true);
    return this.presentDelivery((await WebhookDelivery.findByPk(d.id))!);
  }

  async redeliver(auth: AuthContext, id: string, deliveryId: string) {
    const e = await this.find(id);
    const original = await WebhookDelivery.findOne({ where: { id: deliveryId, endpointId: id } });
    if (!original) throw AppError.notFound('Delivery');
    const copy = await this.db.transaction(async (transaction) => {
      const d = await WebhookDelivery.create({ organizationId: auth.organizationId!, endpointId: e.id, event: original.event, payload: original.payload }, { transaction });
      await this.jobs.enqueue(WEBHOOK_JOB, { deliveryId: d.id }, { transaction, organizationId: auth.organizationId!, maxAttempts: 6 });
      return d;
    });
    return this.presentDelivery(copy);
  }

  // ---- Dispatch & delivery ---------------------------------------------------------------------

  /** Queues a delivery for every enabled endpoint subscribed to the audited action. */
  private async dispatch(row: AuditLog, transaction?: Transaction) {
    const orgId = row.organizationId;
    if (!orgId || WEBHOOK_EXCLUDED_PREFIXES.some((p) => row.action.startsWith(p))) return;
    const endpoints = (await this.endpointsFor(orgId, transaction)).filter((e) => matchesEvent(e.events, row.action));
    for (const e of endpoints) {
      const d = await WebhookDelivery.create({ organizationId: orgId, endpointId: e.id, event: row.action, payload: {} }, { transaction, ...CROSS_TENANT });
      const data = { entityType: row.entityType, entityId: row.entityId, summary: row.summary, actorUserId: row.actorUserId, auditId: row.id };
      await d.update({ payload: this.payload(d.id, row.action, orgId, data, row.createdAt) }, { transaction, ...CROSS_TENANT });
      await this.jobs.enqueue(WEBHOOK_JOB, { deliveryId: d.id }, { transaction, organizationId: orgId, maxAttempts: 6 });
    }
  }

  private async endpointsFor(orgId: string, transaction?: Transaction) {
    const cached = this.cache.get(orgId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.endpoints;
    const endpoints = (await WebhookEndpoint.findAll({ where: { organizationId: orgId, enabled: true }, attributes: ['id', 'events'], transaction, ...CROSS_TENANT })).map((e) => ({ id: e.id, events: e.events }));
    this.cache.set(orgId, { at: Date.now(), endpoints });
    return endpoints;
  }

  private async deliver(deliveryId: string, job: Job<{ deliveryId: string }>) {
    const d = await WebhookDelivery.findByPk(deliveryId, CROSS_TENANT);
    if (!d || d.status !== 'PENDING') return;
    const e = await WebhookEndpoint.findByPk(d.endpointId, CROSS_TENANT);
    if (!e || !e.enabled) {
      await d.update({ status: 'FAILED', error: 'The webhook is switched off' }, CROSS_TENANT);
      return;
    }
    const ok = await this.attempt(d, e, job.attempts >= job.maxAttempts);
    if (!ok) throw new Error(`Webhook delivery ${d.id} failed (${d.error ?? `HTTP ${d.responseStatus}`})`);
  }

  /** One POST. Returns whether it was accepted (2xx). */
  private async attempt(d: WebhookDelivery, e: WebhookEndpoint, last: boolean): Promise<boolean> {
    const body = JSON.stringify(d.payload);
    let status: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      await this.assertReachable(e.url);
      const secret = this.crypto.decrypt(e.secretEncrypted, fields.webhookSecret(e.id));
      const res = await fetch(e.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'user-agent': 'HRMS-Webhooks/1.0', 'x-hrms-event': d.event, 'x-hrms-delivery': d.id, 'x-hrms-signature': signature(secret, body) },
        body,
      });
      status = res.status;
      responseBody = (await res.text()).slice(0, 1000);
    } catch (err) {
      error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    }
    const ok = status !== null && status >= 200 && status < 300;
    await d.update({ attempts: d.attempts + 1, responseStatus: status, responseBody, error, ...(ok ? { status: 'SUCCESS', deliveredAt: new Date() } : last ? { status: 'FAILED' } : {}) }, CROSS_TENANT);
    const failures = ok ? 0 : e.consecutiveFailures + 1;
    const disable = failures >= DISABLE_AFTER_FAILURES;
    await e.update({ lastDeliveryAt: new Date(), lastStatus: status, consecutiveFailures: failures, ...(disable ? { enabled: false, disabledReason: `Switched off after ${failures} failed deliveries in a row` } : {}) }, CROSS_TENANT);
    if (disable) {
      this.cache.delete(e.organizationId);
      this.logger.warn(`Webhook ${e.id} switched off after ${failures} failures`);
    }
    return ok;
  }

  private payload(id: string, event: string, organizationId: string, data: Record<string, unknown>, at = new Date()) {
    return { id, event, createdAt: at.toISOString(), organizationId, data };
  }

  private get production() {
    return this.config.get('NODE_ENV') === 'production';
  }

  private assertUrl(url: string) {
    const u = new URL(url);
    if (this.production && u.protocol !== 'https:') throw AppError.validation([{ field: 'url', message: 'Webhooks must use https://' }]);
    if (this.production && (u.hostname === 'localhost' || (isIP(u.hostname) && ipAllowed(u.hostname, PRIVATE_NETWORKS)))) throw AppError.validation([{ field: 'url', message: 'Webhooks cannot point at a private network' }]);
  }

  /** In production the host must not resolve to a private address (checked at every delivery). */
  private async assertReachable(url: string) {
    if (!this.production) return;
    const host = new URL(url).hostname;
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addresses.some((a) => ipAllowed(a.address, PRIVATE_NETWORKS))) throw new Error('The host resolves to a private address');
  }

  private async find(id: string) {
    const e = await WebhookEndpoint.findByPk(id);
    if (!e) throw AppError.notFound('Webhook');
    return e;
  }

  private present(e: WebhookEndpoint) {
    return {
      id: e.id,
      url: e.url,
      description: e.description,
      events: e.events,
      enabled: e.enabled,
      disabledReason: e.disabledReason,
      consecutiveFailures: e.consecutiveFailures,
      lastDeliveryAt: e.lastDeliveryAt,
      lastStatus: e.lastStatus,
      createdAt: e.createdAt,
    };
  }

  private presentDelivery(d: WebhookDelivery) {
    return { id: d.id, event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, responseBody: d.responseBody, error: d.error, deliveredAt: d.deliveredAt, createdAt: d.createdAt, payload: d.payload };
  }
}
