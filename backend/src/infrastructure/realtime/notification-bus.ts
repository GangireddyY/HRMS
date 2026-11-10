import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const CHANNEL = 'hrms:notifications';
type Listener = () => void;

/**
 * Tells open browser sessions that a user has something new (a notification), so they refresh their own counts.
 * Only the user id travels — no content — over Redis pub/sub when configured (every API instance hears every
 * event), or in process otherwise.
 */
@Injectable()
export class NotificationBus implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationBus.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: Redis | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {
    if (!redis) return;
    this.subscriber = redis.duplicate();
    this.subscriber.on('error', (e) => this.logger.warn(`Redis subscriber: ${e.message}`));
    this.subscriber.subscribe(CHANNEL).catch((e: Error) => this.logger.warn(`Could not subscribe to ${CHANNEL}: ${e.message}`));
    this.subscriber.on('message', (_channel, userId: string) => this.deliver(userId));
  }

  publish(userId: string): void {
    if (this.redis) {
      this.redis.publish(CHANNEL, userId).catch(() => this.deliver(userId));
      return;
    }
    this.deliver(userId);
  }

  subscribe(userId: string, listener: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(userId);
    };
  }

  /** Open streams on this instance (for health / metrics). */
  get connections(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  private deliver(userId: string): void {
    for (const listener of this.listeners.get(userId) ?? []) listener();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
