import type { ErrorCode, PaginationMeta, ValidationIssue } from '@contracts';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details: ValidationIssue[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field → first message, for binding validation errors to form fields. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) if (!out[d.field]) out[d.field] = d.message;
    return out;
  }
}

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

/** Standard list parameters accepted by every paginated endpoint. */
export interface ListQuery extends Query {
  page?: number;
  pageSize?: number;
  sort?: string;
  search?: string;
}

interface AuthHooks {
  getToken(): string | null;
  /** Returns true when a new access token was obtained. */
  refresh(): Promise<boolean>;
  onSessionEnded(): void;
  /** Asks the user to re-confirm their identity for a sensitive action; true when they did (the request is retried). */
  stepUp?(message: string): Promise<boolean>;
}

/** Resolves when the user re-confirmed their identity after STEP_UP_REQUIRED. */
async function confirmStepUp(status: number, payload: { error?: ApiErrorBody } | null): Promise<boolean> {
  return status === 403 && payload?.error?.code === 'STEP_UP_REQUIRED' && !!hooks?.stepUp && (await hooks.stepUp(payload.error.message ?? ''));
}

let hooks: AuthHooks | null = null;

/** Wires the client to the auth store (avoids a circular import). */
export function configureHttpAuth(h: AuthHooks): void {
  hooks = h;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Do not attach the token or attempt refresh (auth endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Set on the first attempt of a write and kept for its retries (refresh, step-up), so the server runs it once. */
  idempotencyKey?: string;
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

interface ApiErrorBody {
  code?: ErrorCode;
  message?: string;
  details?: ValidationIssue[];
  requestId?: string;
}

/**
 * API errors keep the server's message. A response without the API error envelope did not come from
 * the API (dev proxy, gateway or load balancer), so it gets a message based on the status instead.
 */
function toApiError(status: number, err: ApiErrorBody | undefined): ApiError {
  if (err?.message) {
    if (status >= 500) {
      const reference = err.requestId ? ` (Reference: ${err.requestId})` : '';
      return new ApiError(status, err.code ?? 'INTERNAL_ERROR', `Something went wrong on our side. Please try again.${reference}`, [], err.requestId);
    }
    return new ApiError(status, err.code ?? 'BAD_REQUEST', err.message, err.details ?? [], err.requestId);
  }
  if (status >= 500) return new ApiError(status, 'NETWORK_ERROR', "The server isn't responding right now. Please try again in a moment.");
  if (status === 429) return new ApiError(status, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
  if (status === 404) return new ApiError(status, 'NOT_FOUND', "The requested service wasn't found. Refresh the page and try again.");
  if (status === 413) return new ApiError(status, 'BAD_REQUEST', 'The request is too large.');
  return new ApiError(status, 'BAD_REQUEST', `The request couldn't be completed (error ${status}). Please try again.`);
}

async function send(method: string, path: string, opts: RequestOptions, isRetry = false, steppedUp = false): Promise<{ data: unknown; meta?: PaginationMeta }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = opts.body instanceof FormData;
  // The browser sets the multipart boundary itself for FormData bodies.
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const token = opts.anonymous ? null : hooks?.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!opts.anonymous && WRITES.has(method)) {
    // randomUUID needs a secure context (https or localhost); plain-http LAN testing falls back to random values.
    opts.idempotencyKey ??= typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (res.ok) return { data: payload?.data ?? null, meta: payload?.meta };

  const error = toApiError(res.status, payload?.error);

  if (res.status === 401 && !opts.anonymous && hooks) {
    if (!isRetry && (await hooks.refresh())) return send(method, path, opts, true, steppedUp);
    hooks.onSessionEnded();
  }
  if (!steppedUp && (await confirmStepUp(res.status, payload))) return send(method, path, opts, isRetry, true);
  throw error;
}

/** A long-lived authenticated GET (server-sent events); refreshes the session once on 401. */
export async function openStream(path: string, signal: AbortSignal): Promise<Response> {
  const request = () => fetch(buildUrl(path), { headers: { Accept: 'text/event-stream', Authorization: `Bearer ${hooks?.getToken() ?? ''}` }, credentials: 'same-origin', signal });
  let res = await request();
  if (res.status === 401 && hooks && (await hooks.refresh())) res = await request();
  return res;
}

export const http = {
  async get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return (await send('GET', path, { query, signal })).data as T;
  },
  async page<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Page<T>> {
    const { data, meta } = await send('GET', path, { query, signal });
    return { items: (data as T[]) ?? [], meta: meta ?? { page: 1, pageSize: 0, total: 0, totalPages: 1 } };
  },
  async post<T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return (await send('POST', path, { ...opts, body: body ?? {} })).data as T;
  },
  async put<T>(path: string, body?: unknown): Promise<T> {
    return (await send('PUT', path, { body: body ?? {} })).data as T;
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await send('PATCH', path, { body: body ?? {} })).data as T;
  },
  async delete<T>(path: string): Promise<T> {
    return (await send('DELETE', path, {})).data as T;
  },
  /** Authenticated file download (e.g. CSV exports); errors are mapped like any other request. */
  async download(path: string, query?: Query): Promise<Blob> {
    const token = hooks?.getToken();
    const request = () =>
      fetch(buildUrl(path, query), { headers: { Accept: '*/*', ...(token ? { Authorization: `Bearer ${hooks?.getToken()}` } : {}) }, credentials: 'same-origin' });
    let res: Response;
    try {
      res = await request();
      if (res.status === 401 && hooks && (await hooks.refresh())) res = await request();
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
    }
    if (res.ok) return res.blob();
    let payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
    if (await confirmStepUp(res.status, payload)) {
      res = await request();
      if (res.ok) return res.blob();
      payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
    }
    throw toApiError(res.status, payload?.error);
  },
  /** multipart/form-data upload of a single file, with optional text fields and query parameters. */
  async upload<T>(path: string, file: Blob, opts: { field?: string; fileName?: string; fields?: Record<string, string | null | undefined>; query?: Query } = {}): Promise<T> {
    const form = new FormData();
    for (const [k, v] of Object.entries(opts.fields ?? {})) if (v !== undefined && v !== null && v !== '') form.append(k, v);
    if (opts.fileName) form.append(opts.field ?? 'file', file, opts.fileName);
    else form.append(opts.field ?? 'file', file);
    return (await send('POST', path, { body: form, query: opts.query })).data as T;
  },
};

/** File name from Content-Disposition, preferring the UTF-8 `filename*` form. */
function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      // Fall back to the plain name.
    }
  }
  return /filename="?([^";]+)"?/.exec(header)?.[1] ?? null;
}

/** Downloads a file from an authenticated endpoint and saves it in the browser. */
export async function downloadFile(path: string, query: Query | undefined, fallbackName: string): Promise<void> {
  const request = () => fetch(buildUrl(path, query), { headers: { Authorization: `Bearer ${hooks?.getToken() ?? ''}` }, credentials: 'same-origin' });
  let res: Response;
  try {
    res = await request();
    if (res.status === 401 && hooks && (await hooks.refresh())) res = await request();
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    let payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
    if (await confirmStepUp(res.status, payload)) {
      res = await request();
      payload = res.ok ? null : res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
    }
    if (!res.ok) throw toApiError(res.status, payload?.error);
  }
  const name = dispositionName(res.headers.get('content-disposition')) ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Opens an authenticated printable document (HTML from the API, e.g. Form 16) in a new tab. The tab is opened first so
 * pop-up blockers allow it, then pointed at the downloaded copy.
 */
export async function openDocument(path: string, query?: Query): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const blob = await http.download(path, query);
    const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'text/html' }));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Resolves an API-relative asset path (e.g. an organization logo) to a URL usable in <img src>. */
export function apiAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;
}

/** Human-friendly message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
