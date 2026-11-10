import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OrganizationMembership, UserSession } from '../src/database/models';
import { API, PASSWORD, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, refreshCookieFrom, resetDatabase } from './helpers';

const DOMAIN = 'ssoco.test';
const CLIENT_ID = 'hrms-client';
const CLIENT_SECRET = 'top-secret-value';
const APP = 'http://localhost:5173';

/** A minimal OpenID Connect provider: discovery, JWKS and a token endpoint that checks PKCE and the client secret. */
class MockIdp {
  server!: Server;
  issuer = '';
  private readonly key: KeyObject;
  readonly jwk: Record<string, unknown>;
  /** Authorization codes the "user" got at the provider, with what goes into their ID token. */
  readonly codes = new Map<string, { challenge: string; claims: Record<string, unknown> }>();
  tamper: 'none' | 'signature' | 'audience' | 'nonce' = 'none';

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.key = privateKey;
    this.jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  }

  async start() {
    this.server = createServer((req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/.well-known/openid-configuration') return send(200, { issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks` });
      if (req.url === '/jwks') return send(200, { keys: [this.jwk] });
      if (req.url === '/token' && req.method === 'POST') {
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString()));
        req.on('end', () => {
          const form = new URLSearchParams(raw);
          const grant = this.codes.get(form.get('code') ?? '');
          if (!grant || form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) return send(400, { error: 'invalid_grant' });
          const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
          if (challenge !== grant.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
          this.codes.delete(form.get('code')!);
          send(200, { access_token: 'at', token_type: 'Bearer', id_token: this.idToken(grant.claims) });
        });
        return;
      }
      send(404, { error: 'not_found' });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  idToken(claims: Record<string, unknown>) {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = { iss: this.issuer, aud: this.tamper === 'audience' ? 'someone-else' : CLIENT_ID, sub: `sub-${String(claims.email)}`, iat: now, exp: now + 300, email_verified: true, ...claims };
    if (this.tamper === 'nonce') payload.nonce = 'not-the-nonce';
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${enc(payload)}`;
    const signature = sign('RSA-SHA256', Buffer.from(data), this.key).toString('base64url');
    return `${data}.${this.tamper === 'signature' ? signature.slice(0, -4) + 'AAAA' : signature}`;
  }
}

describe('Single sign-on (e2e)', () => {
  let ctx: TestContext;
  const idp = new MockIdp();

  beforeAll(async () => {
    ctx = await createTestApp();
    await idp.start();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    idp.tamper = 'none';
    idp.codes.clear();
  });
  afterAll(async () => {
    idp.server.close();
    await ctx.close();
  });

  async function setup(extra: Record<string, unknown> = {}) {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const config = { enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, emailDomains: [DOMAIN], ...extra };
    const saved = await ctx.http().put(`${API}/organizations/current/sso`).set(h).send(config);
    expect(saved.status).toBe(200);
    return { org, h, slug: org.organization.slug as string };
  }

  /** Browser round trip: start → (provider) → callback. Returns the final redirect and the refresh cookie, if any. */
  async function signIn(slug: string, email: string, opts: { returnTo?: string; claims?: Record<string, unknown> } = {}) {
    const start = await ctx.http().get(`${API}/auth/sso/start/${slug}${opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : ''}`);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.location as string);
    expect(authorize.origin + authorize.pathname).toBe(`${idp.issuer}/authorize`);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const code = `code-${Math.random().toString(36).slice(2)}`;
    idp.codes.set(code, { challenge: authorize.searchParams.get('code_challenge')!, claims: { email, nonce: authorize.searchParams.get('nonce'), given_name: 'Sunita', family_name: 'Rao', ...opts.claims } });
    const callback = await ctx.http().get(`${API}/auth/sso/callback?code=${code}&state=${authorize.searchParams.get('state')}`);
    expect(callback.status).toBe(302);
    const cookies = (callback.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    return { location: callback.headers.location as string, cookie: cookies.length ? refreshCookieFrom(callback) : null, state: authorize.searchParams.get('state')! };
  }

  const session = async (cookie: string) => {
    const refreshed = await ctx.http().post(`${API}/auth/refresh`).set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    return bearer(refreshed.body.data.accessToken);
  };

  it('validates the configuration and never returns the secret', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const put = (body: Record<string, unknown>) => ctx.http().put(`${API}/organizations/current/sso`).set(h).send({ enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, emailDomains: [DOMAIN], ...body });
    expect((await put({ emailDomains: [] })).status).toBe(422);
    expect((await put({ issuer: 'http://idp.example.com' })).status).toBe(422);
    expect((await put({ issuer: 'http://127.0.0.1:1' })).body.error.details[0].message).toMatch(/configuration/);
    const saved = (await put({ emailDomains: ['@SSOCO.test'] })).body.data;
    expect(saved).toMatchObject({ enabled: true, hasClientSecret: true, emailDomains: [DOMAIN], redirectUri: `${APP}/api/v1/auth/sso/callback` });
    expect(JSON.stringify(saved)).not.toContain(CLIENT_SECRET);
    // Keeping the stored secret; another organization can't claim the domain.
    expect((await put({ clientSecret: null, buttonLabel: 'Sign in with Okta' })).body.data).toMatchObject({ hasClientSecret: true, buttonLabel: 'Sign in with Okta' });
    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    const clash = await ctx.http().put(`${API}/organizations/current/sso`).set(oh).send({ enabled: true, issuer: idp.issuer, clientId: 'x', clientSecret: 'y', emailDomains: [DOMAIN] });
    expect(clash.body.error.details[0].message).toMatch(/another organization/);
    const member = await createUser(ctx, {});
    await addMember(ctx, org.organization.id, member.id, ['employee']);
    const mh = bearer((await login(ctx, member.email)).accessToken);
    expect((await ctx.http().get(`${API}/organizations/current/sso`).set(mh)).status).toBe(403);

    expect((await ctx.http().post(`${API}/auth/sso/discover`).send({ email: `x@${DOMAIN}` })).body.data).toMatchObject({ organizationSlug: org.organization.slug, buttonLabel: 'Sign in with Okta', required: false });
    expect((await ctx.http().post(`${API}/auth/sso/discover`).send({ email: 'x@elsewhere.test' })).body.data).toBeNull();
  });

  it('signs members in through the provider, once per state, and checks the ID token', async () => {
    const s = await setup();
    const user = await createUser(ctx, { email: `sunita@${DOMAIN}` });
    await addMember(ctx, s.org.organization.id, user.id, ['employee']);

    const ok = await signIn(s.slug, `Sunita@${DOMAIN}`, { returnTo: '/me/leave' });
    expect(ok.location).toBe(`${APP}/me/leave`);
    const h = await session(ok.cookie!);
    const me = (await ctx.http().get(`${API}/auth/me`).set(h)).body.data;
    expect(me).toMatchObject({ user: { email: `sunita@${DOMAIN}` } });
    expect(JSON.stringify(me)).toContain(s.org.organization.id);
    // The provider just verified the person: counts as a step-up.
    expect((await UserSession.findAll({ where: { userId: user.id }, ...RAW })).some((x) => !!x.stepUpAt)).toBe(true);

    // The state is single use; only paths inside the app are honoured.
    expect((await ctx.http().get(`${API}/auth/sso/callback?code=whatever&state=${ok.state}`)).headers.location).toBe(`${APP}/login?sso_error=expired`);
    expect((await signIn(s.slug, `sunita@${DOMAIN}`, { returnTo: '//evil.example' })).location).toBe(`${APP}/`);

    for (const tamper of ['signature', 'audience', 'nonce'] as const) {
      idp.tamper = tamper;
      const bad = await signIn(s.slug, `sunita@${DOMAIN}`);
      expect(bad).toMatchObject({ location: `${APP}/login?sso_error=provider_error`, cookie: null });
    }
    idp.tamper = 'none';
    expect((await signIn(s.slug, `sunita@${DOMAIN}`, { claims: { email_verified: false } })).location).toBe(`${APP}/login?sso_error=email_unverified`);
    expect((await signIn(s.slug, 'sunita@elsewhere.test')).location).toBe(`${APP}/login?sso_error=domain_not_allowed`);
    expect((await ctx.http().get(`${API}/auth/sso/start/no-such-org`)).headers.location).toBe(`${APP}/login?sso_error=not_configured`);
  });

  it('accepts invitations, provisions new members when allowed and can require SSO', async () => {
    const s = await setup();
    // Not a member: refused until auto-provisioning is on.
    expect((await signIn(s.slug, `new.joiner@${DOMAIN}`)).location).toBe(`${APP}/login?sso_error=no_account`);
    await ctx.http().put(`${API}/organizations/current/sso`).set(s.h).send({ enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, emailDomains: [DOMAIN], autoProvision: true });
    const joined = await signIn(s.slug, `new.joiner@${DOMAIN}`);
    expect(joined.location).toBe(`${APP}/`);
    const nh = await session(joined.cookie!);
    const me = (await ctx.http().get(`${API}/auth/me`).set(nh)).body.data;
    expect(me.user).toMatchObject({ firstName: 'Sunita', lastName: 'Rao' });
    expect(me.permissions).toHaveProperty(['leave.apply']);

    // A pending invitation is accepted on the way in.
    const invited = await createUser(ctx, { email: `invitee@${DOMAIN}` });
    await addMember(ctx, s.org.organization.id, invited.id, ['employee'], 'INVITED');
    expect((await signIn(s.slug, `invitee@${DOMAIN}`)).location).toBe(`${APP}/`);
    expect((await OrganizationMembership.findOne({ where: { userId: invited.id }, ...RAW }))!.status).toBe('ACTIVE');

    // Required: members can't use their password; organization admins still can.
    await ctx.http().put(`${API}/organizations/current/sso`).set(s.h).send({ enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, emailDomains: [DOMAIN], autoProvision: true, required: true });
    const blocked = await ctx.http().post(`${API}/auth/login`).send({ email: `invitee@${DOMAIN}`, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('SSO_REQUIRED');
    expect((await ctx.http().post(`${API}/auth/login`).send({ email: s.org.admin.email, password: PASSWORD })).status).toBe(200);
    expect((await ctx.http().post(`${API}/auth/sso/discover`).send({ email: `x@${DOMAIN}` })).body.data.required).toBe(true);

    // Turning SSO off stops the flow.
    await ctx.http().put(`${API}/organizations/current/sso`).set(s.h).send({ enabled: false, issuer: idp.issuer, clientId: CLIENT_ID, emailDomains: [DOMAIN] });
    expect((await ctx.http().get(`${API}/auth/sso/start/${s.slug}`)).headers.location).toBe(`${APP}/login?sso_error=not_configured`);
    expect((await ctx.http().post(`${API}/auth/login`).send({ email: `invitee@${DOMAIN}`, password: PASSWORD })).status).toBe(200);
  });
});
