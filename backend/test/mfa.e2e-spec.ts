import { AuditLog, MfaRecoveryCode, OrganizationSecurityPolicy, User } from '../src/database/models';
import { API, PASSWORD, RAW, TestContext, bearer, createOrgWithAdmin, createTestApp, login, resetDatabase, totp } from './helpers';

describe('Multi-factor authentication (e2e)', () => {
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

  async function enrol(accessToken: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    const setup = await ctx.http().post(`${API}/auth/mfa/setup`).set(bearer(accessToken));
    expect(setup.status).toBe(200);
    expect(setup.body.data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret: string = setup.body.data.secret;
    const enable = await ctx.http().post(`${API}/auth/mfa/enable`).set(bearer(accessToken)).send({ code: totp(secret) });
    expect(enable.status).toBe(200);
    return { secret, recoveryCodes: enable.body.data.recoveryCodes };
  }

  it('enrols with a valid code, stores the secret encrypted and issues recovery codes', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);

    await ctx.http().post(`${API}/auth/mfa/setup`).set(bearer(s.accessToken));
    const bad = await ctx.http().post(`${API}/auth/mfa/enable`).set(bearer(s.accessToken)).send({ code: '000000' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('MFA_INVALID');

    const { secret, recoveryCodes } = await enrol(s.accessToken);
    expect(recoveryCodes).toHaveLength(10);
    const user = await User.scope('withSecrets').findByPk(admin.id, { rejectOnEmpty: true });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecretEnc).toMatch(/^v1:/);
    expect(user.mfaSecretEnc).not.toContain(secret);

    const status = await ctx.http().get(`${API}/auth/mfa`).set(bearer(s.accessToken));
    expect(status.body.data).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
  });

  it('requires a second factor at login and rejects replayed codes', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const { secret } = await enrol(s.accessToken);

    const first = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD });
    expect(first.body.data.status).toBe('MFA_REQUIRED');
    expect(first.body.data.accessToken).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();
    const challengeToken = first.body.data.challengeToken;

    const wrong = await ctx.http().post(`${API}/auth/mfa/verify`).send({ challengeToken, code: '123456' });
    expect(wrong.status).toBe(401);

    // The enrolment consumed the current step; the next step is still inside the accepted window.
    const code = totp(secret, 1);
    const ok = await ctx.http().post(`${API}/auth/mfa/verify`).send({ challengeToken, code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('AUTHENTICATED');

    const replay = await ctx.http().post(`${API}/auth/mfa/verify`).send({ challengeToken, code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('MFA_INVALID');
  });

  it('accepts each recovery code exactly once', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const { recoveryCodes } = await enrol(s.accessToken);

    const challenge = async () =>
      (await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD })).body.data.challengeToken;

    const firstChallenge = await challenge();
    const ok = await ctx.http().post(`${API}/auth/mfa/verify`).send({ challengeToken: firstChallenge, recoveryCode: recoveryCodes[0].toLowerCase() });
    expect(ok.body.data.status).toBe('AUTHENTICATED');
    const secondChallenge = await challenge();
    const again = await ctx.http().post(`${API}/auth/mfa/verify`).send({ challengeToken: secondChallenge, recoveryCode: recoveryCodes[0] });
    expect(again.status).toBe(401);
    expect(await AuditLog.count({ where: { action: 'auth.mfa_recovery_code_used' }, ...RAW })).toBe(1);
  });

  it('rejects tampered or wrong-purpose challenge tokens', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const res = await ctx.http().post(`${API}/auth/mfa/verify`).send({ challengeToken: s.accessToken, code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('disabling requires both password and a valid code', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const { secret } = await enrol(s.accessToken);

    const badPassword = await ctx.http().post(`${API}/auth/mfa/disable`).set(bearer(s.accessToken)).send({ password: 'wrong', code: totp(secret, 1) });
    expect(badPassword.status).toBe(401);

    const ok = await ctx.http().post(`${API}/auth/mfa/disable`).set(bearer(s.accessToken)).send({ password: PASSWORD, code: totp(secret, 1) });
    expect(ok.status).toBe(200);
    const user = await User.scope('withSecrets').findByPk(admin.id, { rejectOnEmpty: true });
    expect(user.mfaEnabled).toBe(false);
    expect(user.mfaSecretEnc).toBeNull();
    expect(await MfaRecoveryCode.count({ where: { userId: admin.id } })).toBe(0);
  });

  it('restricts sessions until enrolment when the organization requires MFA', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    await OrganizationSecurityPolicy.update({ mfaRequired: true }, { where: { organizationId: organization.id }, ...RAW });

    const s = await login(ctx, admin.email);
    expect(s.body.data.context.mfaSetupRequired).toBe(true);

    const blocked = await ctx.http().get(`${API}/users`).set(bearer(s.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await ctx.http().get(`${API}/auth/me`).set(bearer(s.accessToken))).status).toBe(200);

    const { secret } = await enrol(s.accessToken);
    expect((await ctx.http().get(`${API}/users`).set(bearer(s.accessToken))).status).toBe(200);

    const disable = await ctx.http().post(`${API}/auth/mfa/disable`).set(bearer(s.accessToken)).send({ password: PASSWORD, code: totp(secret, 1) });
    expect(disable.status).toBe(403);
  });
});
