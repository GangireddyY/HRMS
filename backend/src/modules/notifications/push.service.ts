import { readFileSync } from 'node:fs';
import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import webpush, { type PushSubscription as WebPushTarget, type RequestOptions, type SendResult } from 'web-push';
import { categoryOf, EMAIL_CATEGORIES, wantsPush } from '../../contracts';
import { AppError } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { NativePushToken, PushSubscription, User } from '../../database/models';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';
import { ApnsClient } from './apns.client';
import { FcmClient, DeviceGoneError, readFcmCredentials } from './fcm.client';

export const PUSH_JOB = 'notifications.push';
/** Case details never leave the app. */
const DISCREET = new Set(['grievance']);
const MAX_SUBSCRIPTIONS_PER_USER = 10;

export interface PushPayload {
  title: string;
  body: string | null;
  /** Path in the app to open on click. */
  url: string | null;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
}

export type PushSender = (target: WebPushTarget, payload: string, options: RequestOptions) => Promise<SendResult>;
/** Throws DeviceGoneError when the installation's token is no longer valid. */
export type NativeSender = (token: string, payload: PushPayload) => Promise<void>;
export type NativePlatform = 'ANDROID' | 'IOS';

/**
 * Browser (Web Push) and phone app notifications (Android through Firebase Cloud Messaging, iOS through APNs). Each
 * person turns them on per browser, and the app registers itself on sign-in; a notification is then pushed to all
 * their devices through the job queue, for the categories they get by email too (grievance pushes carry no
 * details). Push services that report a device gone drop it.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  /** Replaced in tests; the real one sends through the browser vendor's push service with VAPID. */
  sender: PushSender = (target, payload, options) => webpush.sendNotification(target, payload, options);
  /** Per app platform, from FCM_CREDENTIALS_FILE and the APNS_* settings (replaced in tests); unset = off. */
  nativeSenders: Partial<Record<NativePlatform, NativeSender>> = {};

  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly jobs?: JobQueueService,
  ) {}

  onModuleInit(): void {
    this.jobs?.register<{ userId: string; payload: PushPayload }>(PUSH_JOB, (job) => this.deliver(job.userId, job.payload));
    const file = this.config.get('FCM_CREDENTIALS_FILE');
    if (file) {
      const fcm = new FcmClient(readFcmCredentials(file));
      this.nativeSenders.ANDROID = (token, payload) => fcm.send(token, payload);
    }
    const apnsKey = this.config.get('APNS_KEY_FILE');
    if (apnsKey) {
      const apns = new ApnsClient({
        key: readFileSync(apnsKey, 'utf8'),
        keyId: this.config.get('APNS_KEY_ID')!,
        teamId: this.config.get('APNS_TEAM_ID')!,
        topic: this.config.get('APNS_TOPIC')!,
        production: this.config.get('APNS_PRODUCTION'),
      });
      this.nativeSenders.IOS = (token, payload) => apns.send(token, payload);
    }
  }

  get enabled(): boolean {
    return !!this.config.get('VAPID_PUBLIC_KEY') && !!this.config.get('VAPID_PRIVATE_KEY');
  }

  get nativeEnabled(): boolean {
    return !!(this.nativeSenders.ANDROID ?? this.nativeSenders.IOS);
  }

  private nativePlatforms(): NativePlatform[] {
    return (['ANDROID', 'IOS'] as const).filter((p) => this.nativeSenders[p]);
  }

  async status(userId: string) {
    const [user, devices, apps] = await Promise.all([
      User.findByPk(userId, { attributes: ['notificationSettings'] }),
      PushSubscription.count({ where: { userId } }),
      NativePushToken.count({ where: { userId } }),
    ]);
    return {
      enabled: this.enabled,
      publicKey: this.enabled ? this.config.get('VAPID_PUBLIC_KEY')! : null,
      on: user?.notificationSettings?.push !== false,
      devices,
      nativeEnabled: this.nativeEnabled,
      nativePlatforms: this.nativePlatforms(),
      apps,
    };
  }

  /** The phone app registers its push token after sign-in (and whenever it rotates): FCM on Android, APNs on iOS. */
  async registerNative(userId: string, input: { platform: NativePlatform; token: string; deviceName?: string | null; appVersion?: string | null }) {
    if (!this.nativeSenders[input.platform]) throw AppError.conflict(`${input.platform === 'IOS' ? 'iPhone' : 'Android'} app notifications are not set up on this server`);
    const values = { userId, platform: input.platform, deviceName: input.deviceName?.slice(0, 120) ?? null, appVersion: input.appVersion?.slice(0, 30) ?? null, failureCount: 0 };
    const existing = await NativePushToken.findOne({ where: { token: input.token } });
    if (existing) {
      await existing.update(values);
    } else {
      if ((await NativePushToken.count({ where: { userId } })) >= MAX_SUBSCRIPTIONS_PER_USER) {
        const oldest = await NativePushToken.findOne({ where: { userId }, order: [['updatedAt', 'ASC']] });
        await oldest?.destroy();
      }
      await NativePushToken.create({ ...values, token: input.token });
    }
    return this.status(userId);
  }

  /** On sign-out the app stops receiving the person's notifications. */
  async unregisterNative(userId: string, token: string) {
    await NativePushToken.destroy({ where: { userId, token } });
    return this.status(userId);
  }

  async subscribe(userId: string, input: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | undefined) {
    if (!this.enabled) throw AppError.conflict('Browser notifications are not set up on this server');
    const existing = await PushSubscription.findOne({ where: { endpoint: input.endpoint } });
    if (existing) {
      // The browser re-subscribed (or another account signed in on it): the latest owner gets the pushes.
      await existing.update({ userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null, failureCount: 0 });
    } else {
      if ((await PushSubscription.count({ where: { userId } })) >= MAX_SUBSCRIPTIONS_PER_USER) {
        const oldest = await PushSubscription.findOne({ where: { userId }, order: [['updatedAt', 'ASC']] });
        await oldest?.destroy();
      }
      await PushSubscription.create({ userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null });
    }
    return this.status(userId);
  }

  async unsubscribe(userId: string, endpoint: string) {
    await PushSubscription.destroy({ where: { userId, endpoint } });
    return this.status(userId);
  }

  /** Queued with the notification (sent only if the change commits), when the person has a browser subscribed. */
  async queue(userId: string, input: { type: string; title: string; body?: string; link?: string }, transaction?: Transaction): Promise<void> {
    if ((!this.enabled && !this.nativeEnabled) || !this.jobs) return;
    const category = EMAIL_CATEGORIES.find((c) => c.key === categoryOf(input.type));
    if (!category) return;
    const user = await User.findByPk(userId, { attributes: ['status', 'notificationSettings'], transaction });
    if (!user || user.status !== 'ACTIVE' || !wantsPush(user.notificationSettings, input.type)) return;
    const [browsers, apps] = await Promise.all([
      this.enabled ? PushSubscription.count({ where: { userId }, transaction }) : 0,
      this.nativeEnabled ? NativePushToken.count({ where: { userId, platform: this.nativePlatforms() }, transaction }) : 0,
    ]);
    if (!browsers && !apps) return;
    const discreet = DISCREET.has(category.key);
    const payload: PushPayload = {
      title: discreet ? `There's an update on a ${category.label.toLowerCase().replace(/s$/, '')} case` : input.title.slice(0, 120),
      body: discreet ? 'Open HRMS to see it.' : (input.body?.slice(0, 240) ?? null),
      url: input.link ?? '/me/notifications',
      tag: input.type,
    };
    await this.jobs.enqueue(PUSH_JOB, { userId, payload }, { transaction, organizationId: null, maxAttempts: 3 });
  }

  private async deliver(userId: string, payload: PushPayload): Promise<void> {
    if (this.nativeEnabled) await this.deliverNative(userId, payload);
    if (!this.enabled) return;
    const subs = await PushSubscription.findAll({ where: { userId } });
    const options: RequestOptions = {
      TTL: 3600,
      urgency: 'normal',
      vapidDetails: { subject: this.config.get('VAPID_SUBJECT'), publicKey: this.config.get('VAPID_PUBLIC_KEY')!, privateKey: this.config.get('VAPID_PRIVATE_KEY')! },
    };
    for (const s of subs) {
      try {
        await this.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), options);
        await s.update({ lastSentAt: new Date(), failureCount: 0 });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await s.destroy();
        } else {
          this.logger.warn(`Push to a browser failed (${status ?? (e as Error).message})`);
          if (s.failureCount + 1 >= 20) await s.destroy();
          else await s.update({ failureCount: s.failureCount + 1 });
        }
      }
    }
  }

  private async deliverNative(userId: string, payload: PushPayload): Promise<void> {
    for (const t of await NativePushToken.findAll({ where: { userId, platform: this.nativePlatforms() } })) {
      try {
        await this.nativeSenders[t.platform]!(t.token, payload);
        await t.update({ lastSentAt: new Date(), failureCount: 0 });
      } catch (e) {
        if (e instanceof DeviceGoneError) {
          await t.destroy();
        } else {
          this.logger.warn(`Push to the app failed (${(e as Error).message})`);
          if (t.failureCount + 1 >= 20) await t.destroy();
          else await t.update({ failureCount: t.failureCount + 1 });
        }
      }
    }
  }
}
