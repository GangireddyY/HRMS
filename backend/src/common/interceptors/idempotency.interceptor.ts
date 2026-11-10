import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, Optional, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { from, of, type Observable } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { AppError } from '../errors/app-error';

const HEADER = 'idempotency-key';
const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const TTL_SECONDS = 24 * 3600;
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Stored {
  state: 'PENDING' | 'DONE';
  fingerprint: string;
  body?: unknown;
}

/** Where keys live: Redis (shared by instances, expires by itself) or memory when Redis isn't configured. */
interface KeyStore {
  claim(key: string, value: Stored): Promise<boolean>;
  get(key: string): Promise<Stored | null>;
  set(key: string, value: Stored): Promise<void>;
  release(key: string): Promise<void>;
}

class RedisStore implements KeyStore {
  constructor(private readonly redis: Redis) {}
  async claim(key: string, value: Stored) {
    return (await this.redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS, 'NX')) === 'OK';
  }
  async get(key: string) {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as Stored) : null;
  }
  async set(key: string, value: Stored) {
    await this.redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
  }
  async release(key: string) {
    await this.redis.del(key);
  }
}

export class MemoryStore implements KeyStore {
  private readonly map = new Map<string, { value: Stored; expires: number }>();
  async claim(key: string, value: Stored) {
    if (await this.get(key)) return false;
    this.map.set(key, { value, expires: Date.now() + TTL_SECONDS * 1000 });
    if (this.map.size > 10_000) this.map.delete(this.map.keys().next().value!);
    return true;
  }
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: Stored) {
    this.map.set(key, { value, expires: Date.now() + TTL_SECONDS * 1000 });
  }
  async release(key: string) {
    this.map.delete(key);
  }
}

/**
 * Safe retries for writes: a request with an `Idempotency-Key` header runs once per user, key, method and path; a
 * repeat within 24 hours gets the first response again instead of creating a second record (double clicks, network
 * retries). Reusing a key with a different body, or while the first request is still running, is a conflict. Only
 * successful JSON responses are remembered; a failed request can be retried with the same key. Files are not.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store: KeyStore;

  constructor(@Optional() @Inject(REDIS) redis?: Redis | null) {
    this.store = redis ? new RedisStore(redis) : new MemoryStore();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { auth?: { userId?: string } }>();
    const header = req.headers[HEADER];
    const userId = req.auth?.userId;
    if (!WRITE.has(req.method) || typeof header !== 'string' || !userId) return next.handle();
    if (!KEY.test(header)) throw AppError.badRequest('Idempotency-Key must be 8–100 letters, digits, "-" or "_"');

    const res = context.switchToHttp().getResponse<Response>();
    const key = `hrms:idem:${createHash('sha256').update(`${userId}\n${req.method}\n${req.path}\n${header}`).digest('hex')}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');

    return from(this.store.claim(key, { state: 'PENDING', fingerprint })).pipe(
      mergeMap(async (claimed) => {
        if (claimed) return null;
        const existing = await this.store.get(key);
        if (!existing) return null;
        if (existing.fingerprint !== fingerprint) throw AppError.conflict('This Idempotency-Key was already used for a different request');
        if (existing.state === 'PENDING') throw AppError.conflict('A request with this Idempotency-Key is still being processed');
        return existing;
      }),
      mergeMap((replay) => {
        if (replay) {
          // The status code is the route's own (Nest sets it when sending), so the replay matches the original.
          res.setHeader('Idempotent-Replayed', 'true');
          return of(replay.body);
        }
        return next.handle().pipe(
          mergeMap(async (body) => {
            if (body instanceof StreamableFile) await this.store.release(key);
            else await this.store.set(key, { state: 'DONE', fingerprint, body });
            return body;
          }),
          catchError(async (err: unknown) => {
            await this.store.release(key);
            throw err;
          }),
        );
      }),
    );
  }
}
