import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiAssetUrl, configureHttpAuth, http } from '@/core/http/http-client';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('http client', () => {
  let token: string | null;
  const refresh = vi.fn<() => Promise<boolean>>();
  const onSessionEnded = vi.fn();

  beforeEach(() => {
    token = 'old';
    refresh.mockReset();
    onSessionEnded.mockReset();
    configureHttpAuth({ getToken: () => token, refresh, onSessionEnded });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('unwraps the success envelope and sends the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true, data: { id: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(http.get('/things', { page: 2, search: '', status: undefined })).resolves.toEqual({ id: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/things?page=2');
    expect(init.headers.Authorization).toBe('Bearer old');
  });

  it('returns pagination meta for list endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { success: true, data: [1, 2], meta: { page: 1, pageSize: 2, total: 5, totalPages: 3 } })));
    const page = await http.page<number>('/things');
    expect(page.items).toEqual([1, 2]);
    expect(page.meta.totalPages).toBe(3);
  });

  it('maps failures to ApiError with field details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(422, { success: false, error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details: [{ field: 'email', message: 'email must be an email' }], requestId: 'r1' } })));
    const err = (await http.post('/x', {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fieldErrors()).toEqual({ email: 'email must be an email' });
    expect(err.requestId).toBe('r1');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { success: true, data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    refresh.mockImplementation(async () => {
      token = 'new';
      return true;
    });
    await expect(http.get('/me')).resolves.toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer new');
  });

  it('ends the session when refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { success: false, error: { code: 'SESSION_REVOKED', message: 'revoked' } })));
    refresh.mockResolvedValue(false);
    await expect(http.get('/me')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it('never refreshes for anonymous auth calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } })));
    await expect(http.post('/auth/login', {}, { anonymous: true })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uploads files as multipart form data without forcing a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, { success: true, data: { logoUrl: '/organizations/o1/logo?v=1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new Blob(['png'], { type: 'image/png' });
    await expect(http.upload('/organizations/current/logo', file)).resolves.toEqual({ logoUrl: '/organizations/o1/logo?v=1' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('resolves API-relative asset paths', () => {
    expect(apiAssetUrl('/organizations/o1/logo?v=1')).toBe('/api/v1/organizations/o1/logo?v=1');
    expect(apiAssetUrl('https://cdn.example/logo.png')).toBe('https://cdn.example/logo.png');
    expect(apiAssetUrl(null)).toBeNull();
  });

  it('reports network failures distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(http.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('explains responses that did not come from the API (proxy or gateway errors)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(http.post('/auth/login', {}, { anonymous: true })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: "The server isn't responding right now. Please try again in a moment.",
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })));
    await expect(http.get('/x')).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' });
  });

  it('gives a friendly message with a support reference for server errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: 'req-42' } })));
    await expect(http.get('/x')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: 'req-42',
      message: 'Something went wrong on our side. Please try again. (Reference: req-42)',
    });
  });
});
