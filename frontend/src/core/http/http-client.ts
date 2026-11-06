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
}

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

async function send(method: string, path: string, opts: RequestOptions, isRetry = false): Promise<{ data: unknown; meta?: PaginationMeta }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = opts.body instanceof FormData;
  // The browser sets the multipart boundary itself for FormData bodies.
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const token = opts.anonymous ? null : hooks?.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

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
    if (!isRetry && (await hooks.refresh())) return send(method, path, opts, true);
    hooks.onSessionEnded();
  }
  throw error;
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
    const payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
    throw toApiError(res.status, payload?.error);
  },
  /** multipart/form-data upload of a single file. */
  async upload<T>(path: string, file: Blob, field = 'file'): Promise<T> {
    const form = new FormData();
    form.append(field, file);
    return (await send('POST', path, { body: form })).data as T;
  },
};

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
    const payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
    throw toApiError(res.status, payload?.error);
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
