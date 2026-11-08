import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';

const context: AccessContext = {
  user: { id: 'u1', email: 'a@b.test', firstName: 'A', lastName: 'B', phone: null, platformRole: null, mfaEnabled: false, lastLoginAt: null, avatarUrl: null, preferences: {} },
  activeOrganization: { id: 'o1', name: 'Org', slug: 'org', status: 'ACTIVE', logoUrl: null, brandColor: null },
  organizations: [],
  roles: [{ id: 'r1', key: 'team_lead', name: 'Team Lead' }],
  permissions: { 'leave.approve': 'TEAM', 'leave.apply': 'ORGANIZATION' },
  platformPermissions: [],
  features: ['core', 'leave'],
  mfaSetupRequired: false,
  passwordExpired: false,
  idleTimeoutMinutes: 120,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('evaluates permissions with scope coverage', () => {
    const auth = useAuthStore();
    auth.context = context;
    expect(auth.can('leave.approve', 'OWN')).toBe(true);
    expect(auth.can('leave.approve', 'TEAM')).toBe(true);
    expect(auth.can('leave.approve', 'DEPARTMENT')).toBe(false);
    expect(auth.can('payroll.view')).toBe(false);
    expect(auth.hasFeature('leave')).toBe(true);
    expect(auth.hasFeature('payroll')).toBe(false);
  });

  it('stores the session only after full authentication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ success: true, data: { status: 'MFA_REQUIRED', challengeToken: 'c' } })));
    const auth = useAuthStore();
    const result = await auth.login('a@b.test', 'pw');
    expect(result.status).toBe('MFA_REQUIRED');
    expect(auth.isAuthenticated).toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ success: true, data: { status: 'AUTHENTICATED', accessToken: 't', expiresIn: 900, context } })));
    await auth.verifyMfa('c', { code: '123456' });
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.accessToken).toBe('t');
  });

  it('shares a single in-flight refresh between concurrent callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: true, data: { accessToken: 'fresh', expiresIn: 900 } }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = useAuthStore();
    const [a, b] = await Promise.all([auth.refresh(), auth.refresh()]);
    expect(a && b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.accessToken).toBe('fresh');
  });

  it('bootstraps an anonymous visitor without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'No refresh token' } }, 401)));
    const auth = useAuthStore();
    await auth.bootstrap();
    expect(auth.initialized).toBe(true);
    expect(auth.isAuthenticated).toBe(false);
  });

  it('clears state and notifies listeners when the session ends', () => {
    const auth = useAuthStore();
    auth.context = context;
    auth.accessToken = 't';
    const listener = vi.fn();
    auth.onSessionEnded(listener);
    auth.sessionEnded();
    expect(auth.isAuthenticated).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });
});
