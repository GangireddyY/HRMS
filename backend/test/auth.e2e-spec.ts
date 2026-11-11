import { createHash } from 'node:crypto';
import { ActionToken, AuditLog, LoginEvent, User, UserSession } from '../src/database/models';
import { BreachedPasswordService } from '../src/infrastructure/crypto/breached-password.service';
import {
  API,
  PASSWORD,
  RAW,
  TestContext,
  addMember,
  bearer,
  createOrgWithAdmin,
  createTestApp,
  createUser,
  login,
  refreshCookieFrom,
  resetDatabase,
  tokenFromMail,
  uniqueEmail,
} from './helpers';

describe('Authentication (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('login', () => {
    it('authenticates and returns access context with an HttpOnly refresh cookie', async () => {
      const { admin, organization } = await createOrgWithAdmin(ctx);
      const res = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('AUTHENTICATED');
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.context.activeOrganization.id).toBe(organization.id);
      expect(res.body.data.context.roles.map((r: { key: string }) => r.key)).toEqual(['org_admin']);
      expect(res.body.data.context.permissions['user.view']).toBe('ORGANIZATION');

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('hrms_rt='))!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('accepts email case-insensitively', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const res = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email.toUpperCase(), password: PASSWORD });
      expect(res.status).toBe(200);
    });

    it('returns the same generic error for wrong password and unknown user', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const wrong = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: 'Wrong-Password-1' });
      const unknown = await ctx.http().post(`${API}/auth/login`).send({ email: 'nobody@example.test', password: 'Wrong-Password-1' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('validates input', async () => {
      const res = await ctx.http().post(`${API}/auth/login`).send({ email: 'not-an-email' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['email', 'password']));
    });

    it('rejects unknown body fields', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const res = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD, isAdmin: true });
      expect(res.status).toBe(422);
    });

    it('locks the account after repeated failures and records login history', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      for (let i = 0; i < 5; i++) {
        await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: 'Wrong-Password-1' });
      }
      // A wrong guess against the locked account looks like any other wrong guess (no account enumeration)…
      const guess = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: 'Wrong-Password-2' });
      expect(guess.status).toBe(401);
      expect(guess.body.error.code).toBe('INVALID_CREDENTIALS');
      // …only the right password learns that the account is locked.
      const locked = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD });
      expect(locked.status).toBe(423);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

      const events = await LoginEvent.findAll({ where: { userId: admin.id }, order: [['createdAt', 'ASC']], ...RAW });
      expect(events.map((e) => e.outcome)).toEqual(['FAILURE', 'FAILURE', 'FAILURE', 'FAILURE', 'LOCKED', 'LOCKED', 'LOCKED']);
      expect(await AuditLog.count({ where: { action: 'auth.account_locked', entityId: admin.id }, ...RAW })).toBe(1);
    });

    it('rejects users without any active organization', async () => {
      const user = await createUser(ctx);
      const res = await ctx.http().post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD });
      expect(res.status).toBe(403);
    });

    it('rejects disabled accounts', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      await User.update({ status: 'DISABLED' }, { where: { id: admin.id } });
      const res = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('access tokens and sessions', () => {
    it('requires a bearer token on protected routes', async () => {
      const res = await ctx.http().get(`${API}/auth/me`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects forged tokens', async () => {
      const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwic2lkIjoieSIsIm9pZCI6bnVsbH0.c2lnbmF0dXJl';
      const res = await ctx.http().get(`${API}/auth/me`).set(bearer(forged));
      expect(res.status).toBe(401);
    });

    it('rotates refresh tokens and revokes the session when a used token is replayed', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const session = await login(ctx, admin.email);

      const first = await ctx.http().post(`${API}/auth/refresh`).set('Cookie', session.cookie);
      expect(first.status).toBe(200);
      const rotated = refreshCookieFrom(first);
      expect(rotated).not.toBe(session.cookie);

      const replay = await ctx.http().post(`${API}/auth/refresh`).set('Cookie', session.cookie);
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('SESSION_REVOKED');

      // The legitimate rotated token is now also dead, as is the access token.
      expect((await ctx.http().post(`${API}/auth/refresh`).set('Cookie', rotated)).status).toBe(401);
      expect((await ctx.http().get(`${API}/auth/me`).set(bearer(first.body.data.accessToken))).status).toBe(401);
      expect(await AuditLog.count({ where: { action: 'auth.refresh_token_reuse' }, ...RAW })).toBe(1);
    });

    it('rejects refresh without a cookie', async () => {
      const res = await ctx.http().post(`${API}/auth/refresh`);
      expect(res.status).toBe(401);
    });

    it('logout revokes the session immediately', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const session = await login(ctx, admin.email);
      expect((await ctx.http().get(`${API}/auth/me`).set(bearer(session.accessToken))).status).toBe(200);

      const out = await ctx.http().post(`${API}/auth/logout`).set('Cookie', session.cookie);
      expect(out.status).toBe(200);
      const after = await ctx.http().get(`${API}/auth/me`).set(bearer(session.accessToken));
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('SESSION_REVOKED');
    });

    it('lists sessions and revokes other sessions', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const a = await login(ctx, admin.email);
      const b = await login(ctx, admin.email);

      const list = await ctx.http().get(`${API}/auth/sessions`).set(bearer(a.accessToken));
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

      const revoke = await ctx.http().post(`${API}/auth/sessions/revoke-others`).set(bearer(a.accessToken));
      expect(revoke.body.data.revoked).toBe(1);
      expect((await ctx.http().get(`${API}/auth/me`).set(bearer(b.accessToken))).status).toBe(401);
      expect((await ctx.http().get(`${API}/auth/me`).set(bearer(a.accessToken))).status).toBe(200);
    });

    it('cannot revoke another user\'s session', async () => {
      const { admin, organization } = await createOrgWithAdmin(ctx);
      const other = await createUser(ctx);
      await addMember(ctx, organization.id, other.id, ['employee']);
      const mine = await login(ctx, admin.email);
      await login(ctx, other.email);
      const otherSession = await UserSession.findOne({ where: { userId: other.id }, rejectOnEmpty: true });
      const res = await ctx.http().delete(`${API}/auth/sessions/${otherSession.id}`).set(bearer(mine.accessToken));
      expect(res.status).toBe(404);
    });

    it('exposes own login history', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const s = await login(ctx, admin.email);
      const res = await ctx.http().get(`${API}/auth/login-history`).set(bearer(s.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].outcome).toBe('SUCCESS');
    });
  });

  describe('password recovery', () => {
    it('does not reveal whether an email exists', async () => {
      const res = await ctx.http().post(`${API}/auth/forgot-password`).send({ email: 'ghost@example.test' });
      expect(res.status).toBe(202);
      expect(ctx.mail.outbox).toHaveLength(0);
    });

    it('resets the password with a single-use token and revokes sessions', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const session = await login(ctx, admin.email);

      expect((await ctx.http().post(`${API}/auth/forgot-password`).send({ email: admin.email })).status).toBe(202);
      const token = tokenFromMail(ctx, admin.email);

      const inspect = await ctx.http().post(`${API}/auth/tokens/inspect`).send({ token, purpose: 'PASSWORD_RESET' });
      expect(inspect.status).toBe(200);
      expect(inspect.body.data.passwordPolicy.minLength).toBe(12);

      const weak = await ctx.http().post(`${API}/auth/reset-password`).send({ token, password: 'short' });
      expect(weak.status).toBe(422);
      expect(weak.body.error.code).toBe('PASSWORD_POLICY_VIOLATION');

      const reused = await ctx.http().post(`${API}/auth/reset-password`).send({ token, password: PASSWORD });
      expect(reused.status).toBe(422);
      expect(JSON.stringify(reused.body.error.details)).toContain('last 5 passwords');

      const newPassword = 'Brand-New-Secret-77';
      expect((await ctx.http().post(`${API}/auth/reset-password`).send({ token, password: newPassword })).status).toBe(200);
      expect((await ctx.http().get(`${API}/auth/me`).set(bearer(session.accessToken))).status).toBe(401);
      await login(ctx, admin.email, newPassword);

      const again = await ctx.http().post(`${API}/auth/reset-password`).send({ token, password: 'Another-Secret-88' });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects expired tokens', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      await ctx.http().post(`${API}/auth/forgot-password`).send({ email: admin.email });
      const token = tokenFromMail(ctx, admin.email);
      await ActionToken.update({ expiresAt: new Date(Date.now() - 1000) }, { where: {} });
      const res = await ctx.http().post(`${API}/auth/reset-password`).send({ token, password: 'Brand-New-Secret-77' });
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('only the latest reset token is valid', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      await ctx.http().post(`${API}/auth/forgot-password`).send({ email: admin.email });
      const first = tokenFromMail(ctx, admin.email);
      await ctx.http().post(`${API}/auth/forgot-password`).send({ email: admin.email });
      const res = await ctx.http().post(`${API}/auth/tokens/inspect`).send({ token: first, purpose: 'PASSWORD_RESET' });
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });
  });

  describe('change password', () => {
    it('requires the current password', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const s = await login(ctx, admin.email);
      const res = await ctx.http().post(`${API}/auth/change-password`).set(bearer(s.accessToken)).send({ currentPassword: 'nope', newPassword: 'Brand-New-Secret-77' });
      expect(res.status).toBe(401);
    });

    it('changes the password, keeps the current session and revokes others', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const current = await login(ctx, admin.email);
      const other = await login(ctx, admin.email);
      const res = await ctx.http().post(`${API}/auth/change-password`).set(bearer(current.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'Brand-New-Secret-77' });
      expect(res.status).toBe(200);
      expect((await ctx.http().get(`${API}/auth/me`).set(bearer(current.accessToken))).status).toBe(200);
      expect((await ctx.http().get(`${API}/auth/me`).set(bearer(other.accessToken))).status).toBe(401);

      const notifications = await ctx.http().get(`${API}/notifications`).set(bearer(current.accessToken));
      expect(notifications.body.data[0].title).toBe('Your password was changed');
    });

    it('rejects passwords containing the user\'s name', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const s = await login(ctx, admin.email);
      const res = await ctx.http().post(`${API}/auth/change-password`).set(bearer(s.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'Olivia-Secret-2026!' });
      expect(res.status).toBe(422);
    });

    it('rejects passwords found in data breaches (sending only a hash prefix)', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const s = await login(ctx, admin.email);
      const breached = ctx.app.get(BreachedPasswordService);
      const leaked = createHash('sha1').update('Summer-Holiday-2024!').digest('hex').toUpperCase();
      const asked: string[] = [];
      const enabled = jest.spyOn(breached, 'enabled', 'get').mockReturnValue(true);
      const original = breached.fetchRange;
      breached.fetchRange = async (prefix) => {
        asked.push(prefix);
        return `${leaked.slice(5)}:731\r\n0123456789ABCDEF0123456789ABCDEF012:3`;
      };
      try {
        const res = await ctx.http().post(`${API}/auth/change-password`).set(bearer(s.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'Summer-Holiday-2024!' });
        expect(res.status).toBe(422);
        expect(res.body.error.details[0].message).toMatch(/appeared in a data breach/);
        expect(asked).toEqual([leaked.slice(0, 5)]);
        // A password not in the response passes.
        expect((await ctx.http().post(`${API}/auth/change-password`).set(bearer(s.accessToken)).send({ currentPassword: PASSWORD, newPassword: 'Quiet-Lantern-Orbit-58' })).status).toBe(200);
      } finally {
        enabled.mockRestore();
        breached.fetchRange = original;
      }
    });
  });

  describe('profile', () => {
    it('updates permitted profile fields and audits the change', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const s = await login(ctx, admin.email);
      const res = await ctx.http().patch(`${API}/auth/me`).set(bearer(s.accessToken)).send({ firstName: 'Liv', phone: '+91 98765 43210' });
      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Liv');
      const audit = await AuditLog.findOne({ where: { action: 'user.profile_updated' }, rejectOnEmpty: true, ...RAW });
      expect(audit.changes).toMatchObject({ firstName: { from: 'Olivia', to: 'Liv' } });
    });

    it('does not allow changing email or platform role through the profile endpoint', async () => {
      const { admin } = await createOrgWithAdmin(ctx);
      const s = await login(ctx, admin.email);
      const res = await ctx.http().patch(`${API}/auth/me`).set(bearer(s.accessToken)).send({ platformRole: 'SUPER_ADMIN', email: uniqueEmail() });
      expect(res.status).toBe(422);
    });
  });

  describe('rate limiting', () => {
    afterEach(() => {
      delete process.env.TEST_ENABLE_THROTTLE;
    });

    it('throttles repeated login attempts', async () => {
      process.env.TEST_ENABLE_THROTTLE = '1';
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await ctx.http().post(`${API}/auth/login`).send({ email: 'ghost@example.test', password: 'Wrong-Password-1' });
        statuses.push(res.status);
      }
      expect(statuses).toContain(429);
    });
  });
});
