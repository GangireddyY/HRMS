import { Injectable, Optional } from '@nestjs/common';
import { NotificationBus } from '../../infrastructure/realtime/notification-bus';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { PaginationQueryDto, paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { AppConfig } from '../../config/app-config.service';
import { EMAIL_CATEGORIES, DEFAULT_MUTED_CATEGORIES, type NotificationSettings, categoryOf, wantsEmail } from '../../contracts';
import { Notification, Organization, User } from '../../database/models';
import { MailService } from '../../infrastructure/mail/mail.service';
import { notificationEmail } from '../../infrastructure/mail/templates';
import { PushService } from './push.service';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Null/undefined = personal notification visible in every organization. */
  organizationId?: string | null;
}

const PUBLIC_ATTRIBUTES = ['id', 'type', 'title', 'body', 'link', 'readAt', 'createdAt'];
/** Case details stay in the app. */
const DISCREET_CATEGORIES = new Set(['grievance']);
const ORG_NAME_TTL_MS = 60_000;

/**
 * In-app notifications. Visible to a user when personal (no organization) or belonging to the
 * user's active organization. Workflow notifications are also emailed unless the person turned that category off.
 */
@Injectable()
export class NotificationsService {
  private readonly orgNames = new Map<string, { name: string; at: number }>();

  constructor(
    @Optional() private readonly bus?: NotificationBus,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly config?: AppConfig,
    @Optional() private readonly push?: PushService,
  ) {}

  async notify(userId: string, input: NotificationInput, transaction?: Transaction): Promise<void> {
    await Notification.create(
      {
        userId,
        organizationId: input.organizationId ?? null,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body ?? null,
        link: input.link ?? null,
      },
      { transaction },
    );
    await this.email(userId, input, transaction);
    await this.push?.queue(userId, input, transaction);
    // Open sessions refresh once the notification is visible to them.
    if (transaction) transaction.afterCommit(() => this.bus?.publish(userId));
    else this.bus?.publish(userId);
  }

  /** Queued with the notification, so it's only sent if the change commits. */
  private async email(userId: string, input: NotificationInput, transaction?: Transaction): Promise<void> {
    if (!this.mail || !this.config) return;
    const category = EMAIL_CATEGORIES.find((c) => c.key === categoryOf(input.type));
    if (!category) return;
    const user = await User.findByPk(userId, { attributes: ['email', 'firstName', 'status', 'notificationSettings'], transaction });
    if (!user || user.status !== 'ACTIVE' || !wantsEmail(user.notificationSettings, input.type)) return;
    const appUrl = this.config.get('APP_URL');
    const message = notificationEmail(
      user.email,
      user.firstName,
      {
        title: input.title,
        body: input.body,
        url: input.link ? `${appUrl}${input.link}` : null,
        organization: input.organizationId ? await this.organizationName(input.organizationId, transaction) : null,
        category: category.label,
        discreet: DISCREET_CATEGORIES.has(category.key),
      },
      `${appUrl}/me/notifications?settings=1`,
    );
    await this.mail.queue(message, { transaction });
  }

  private async organizationName(id: string, transaction?: Transaction): Promise<string | null> {
    const cached = this.orgNames.get(id);
    if (cached && Date.now() - cached.at < ORG_NAME_TTL_MS) return cached.name;
    const org = await Organization.findByPk(id, { attributes: ['name'], transaction });
    if (!org) return null;
    this.orgNames.set(id, { name: org.name, at: Date.now() });
    return org.name;
  }

  async settings(userId: string) {
    const user = await User.findByPk(userId, { attributes: ['notificationSettings'] });
    if (!user) throw AppError.notFound('User');
    return present(user.notificationSettings);
  }

  async updateSettings(userId: string, input: { email: boolean; muted: string[]; push?: boolean }) {
    const known = new Set<string>(EMAIL_CATEGORIES.map((c) => c.key));
    const unknown = input.muted.filter((m) => !known.has(m));
    if (unknown.length) throw AppError.badRequest(`Unknown notification categories: ${unknown.join(', ')}`);
    const current = await User.findByPk(userId, { attributes: ['notificationSettings'] });
    const push = input.push ?? current?.notificationSettings?.push;
    const next: NotificationSettings = { email: input.email, muted: [...new Set(input.muted)], ...(push === undefined ? {} : { push }) };
    const [count] = await User.update({ notificationSettings: next }, { where: { id: userId } });
    if (count === 0) throw AppError.notFound('User');
    return present(next);
  }

  private visibleTo(userId: string, organizationId: string | null): WhereOptions<Notification> {
    return {
      userId,
      [Op.or]: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])],
    };
  }

  async list(userId: string, organizationId: string | null, query: PaginationQueryDto & { unreadOnly?: boolean }) {
    const where: WhereOptions<Notification> = {
      [Op.and]: [this.visibleTo(userId, organizationId), ...(query.unreadOnly ? [{ readAt: null }] : [])],
    };
    const { offset, limit } = paginationArgs(query);
    const { rows, count } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      offset,
      limit,
      attributes: PUBLIC_ATTRIBUTES,
    });
    return new PaginatedResult(rows, paginationMeta(query, count));
  }

  unreadCount(userId: string, organizationId: string | null): Promise<number> {
    return Notification.count({ where: { [Op.and]: [this.visibleTo(userId, organizationId), { readAt: null }] } });
  }

  async markRead(userId: string, organizationId: string | null, id: string): Promise<void> {
    const [count] = await Notification.update({ readAt: new Date() }, { where: { [Op.and]: [{ id }, this.visibleTo(userId, organizationId)] } });
    if (count === 0) throw AppError.notFound('Notification');
  }

  async markAllRead(userId: string, organizationId: string | null): Promise<number> {
    const [count] = await Notification.update({ readAt: new Date() }, { where: { [Op.and]: [this.visibleTo(userId, organizationId), { readAt: null }] } });
    return count;
  }
}

function present(settings: NotificationSettings | null | undefined) {
  return {
    email: settings?.email !== false,
    push: settings?.push !== false,
    muted: settings?.muted ?? [...DEFAULT_MUTED_CATEGORIES],
    categories: EMAIL_CATEGORIES.map((c) => ({ key: c.key, label: c.label, description: c.description })),
  };
}
