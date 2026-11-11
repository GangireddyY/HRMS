import { Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Op } from 'sequelize';
import { categoryOf, digestDue, EMAIL_CATEGORIES, wantsEmail } from '../../contracts';
import { AppConfig } from '../../config/app-config.service';
import { Notification, Organization, User } from '../../database/models';
import { MailService } from '../../infrastructure/mail/mail.service';
import { digestEmail, type DigestGroup } from '../../infrastructure/mail/templates';

const TICK_MS = 15 * 60_000;
const MAX_ITEMS = 50;
const DISCREET = new Set(['grievance']);

/**
 * Daily and weekly email summaries for people who chose them instead of one email per notification: from their chosen
 * local hour, the unread notifications since the last summary (in the categories they get by email). Every 15 minutes,
 * started by the API server only.
 */
@Injectable()
export class NotificationDigestService implements OnModuleDestroy {
  private readonly logger = new Logger('NotificationDigest');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly mail?: MailService,
  ) {}

  start(): void {
    if (this.timer || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Sends the summaries due at `now`; returns how many went out. */
  async tick(now = new Date()): Promise<number> {
    if (this.running || !this.mail) return 0;
    this.running = true;
    let sent = 0;
    try {
      const users = await User.findAll({ where: { status: 'ACTIVE', notificationSettings: { emailDigest: { [Op.in]: ['DAILY', 'WEEKLY'] } } }, attributes: ['id', 'email', 'firstName', 'notificationSettings'] });
      for (const user of users) {
        if (!digestDue(user.notificationSettings, now)) continue;
        try {
          if (await this.send(user, now)) sent++;
        } catch (e) {
          this.logger.warn(`Digest for user ${user.id} failed: ${(e as Error).message}`);
        }
      }
      if (sent) this.logger.log(`Sent ${sent} notification digest${sent === 1 ? '' : 's'}`);
    } finally {
      this.running = false;
    }
    return sent;
  }

  private async send(user: User, now: Date): Promise<boolean> {
    const settings = user.notificationSettings!;
    const weekly = settings.emailDigest === 'WEEKLY';
    const since = settings.lastDigestAt ? new Date(settings.lastDigestAt) : new Date(now.getTime() - (weekly ? 7 : 1) * 86_400_000);
    // Claimed first, so with several servers each person gets one summary.
    const [claimed] = await User.update(
      { notificationSettings: { ...settings, lastDigestAt: now.toISOString() } },
      { where: { id: user.id, ...(settings.lastDigestAt ? { notificationSettings: { lastDigestAt: settings.lastDigestAt } } : {}) } },
    );
    if (!claimed) return false;
    const rows = await Notification.findAll({ where: { userId: user.id, readAt: null, createdAt: { [Op.gt]: since, [Op.lte]: now } }, order: [['createdAt', 'DESC']], limit: 500 });
    const wanted = rows.filter((n) => wantsEmail(settings, n.type)).slice(0, MAX_ITEMS);
    if (!wanted.length) return false;
    const orgIds = [...new Set(wanted.map((n) => n.organizationId).filter((x): x is string => !!x))];
    const orgNames = orgIds.length ? new Map((await Organization.findAll({ where: { id: orgIds }, attributes: ['id', 'name'] })).map((o) => [o.id, o.name])) : new Map<string, string>();
    const appUrl = this.config.get('APP_URL');
    const groups = new Map<string | null, DigestGroup>();
    for (const n of wanted) {
      const key = n.organizationId ?? null;
      const category = EMAIL_CATEGORIES.find((c) => c.key === categoryOf(n.type))!;
      const discreet = DISCREET.has(category.key);
      if (!groups.has(key)) groups.set(key, { organization: key ? (orgNames.get(key) ?? null) : null, items: [] });
      groups.get(key)!.items.push({
        title: discreet ? `There's an update on a ${category.label.toLowerCase().replace(/s$/, '')} case` : n.title,
        body: discreet ? null : n.body,
        url: n.link ? `${appUrl}${n.link}` : null,
        category: category.label,
        at: n.createdAt.toISOString(),
      });
    }
    await this.mail!.queue(digestEmail(user.email, user.firstName, weekly ? 'weekly' : 'daily', [...groups.values()], `${appUrl}/me/notifications`, `${appUrl}/me/notifications?settings=1`));
    return true;
  }
}
