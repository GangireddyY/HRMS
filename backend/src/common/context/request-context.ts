import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
  /** Validated active organization (set only after membership has been verified). */
  organizationId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Ambient per-request context, propagated across async boundaries. */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  organizationId(): string | undefined {
    return storage.getStore()?.organizationId;
  },

  set(patch: Partial<RequestContextStore>): void {
    const store = storage.getStore();
    if (store) Object.assign(store, patch);
  },

  /**
   * Runs `fn` bound to a tenant (background jobs, seeds, tests). The result is awaited inside the
   * context so every query issued by `fn` (including after `await`s) sees the tenant.
   */
  runForTenant<T>(organizationId: string, fn: () => T | Promise<T>, extra: Partial<RequestContextStore> = {}): Promise<T> {
    return storage.run({ requestId: extra.requestId ?? `job-${Date.now()}`, ...extra, organizationId }, async () => await fn());
  },
};
