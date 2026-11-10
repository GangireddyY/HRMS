import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  given_name?: string;
  family_name?: string;
  name?: string;
  preferred_username?: string;
}

export class OidcError extends Error {
  constructor(
    readonly code: 'discovery_failed' | 'token_exchange_failed' | 'invalid_id_token',
    message: string,
  ) {
    super(message);
  }
}

const CACHE_MS = 10 * 60_000;
const CLOCK_SKEW_S = 60;
const b64url = (buf: Buffer) => buf.toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');

/** PKCE (S256) verifier and challenge. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export const randomToken = (bytes = 32) => b64url(randomBytes(bytes));
export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * A small OpenID Connect relying party: discovery, the authorization-code exchange (with PKCE) and ID token checks
 * (RS256 / ES256 signature from the provider's JWKS, issuer, audience, expiry and nonce). Discovery documents and
 * key sets are cached for ten minutes; an unknown key id refreshes the key set once.
 */
export class OidcClient {
  private readonly discoveries = new Map<string, { at: number; value: OidcDiscovery }>();
  private readonly keySets = new Map<string, { at: number; keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[] }>();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async discover(issuer: string, fresh = false): Promise<OidcDiscovery> {
    const key = issuer.replace(/\/+$/, '');
    const cached = this.discoveries.get(key);
    if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    let doc: Partial<OidcDiscovery>;
    try {
      const res = await this.fetcher(`${key}/.well-known/openid-configuration`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = (await res.json()) as Partial<OidcDiscovery>;
    } catch (e) {
      throw new OidcError('discovery_failed', `Could not read the provider's configuration (${e instanceof Error ? e.message : 'unreachable'})`);
    }
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer) throw new OidcError('discovery_failed', 'The provider configuration is incomplete');
    if (doc.issuer.replace(/\/+$/, '') !== key) throw new OidcError('discovery_failed', `The provider says its issuer is ${doc.issuer}`);
    const value = doc as OidcDiscovery;
    this.discoveries.set(key, { at: Date.now(), value });
    return value;
  }

  authorizationUrl(d: OidcDiscovery, p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; loginHint?: string }): string {
    const url = new URL(d.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', p.clientId);
    url.searchParams.set('redirect_uri', p.redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', p.state);
    url.searchParams.set('nonce', p.nonce);
    url.searchParams.set('code_challenge', p.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (p.loginHint) url.searchParams.set('login_hint', p.loginHint);
    return url.toString();
  }

  async exchangeCode(d: OidcDiscovery, p: { code: string; redirectUri: string; clientId: string; clientSecret: string | null; verifier: string }): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier });
    if (p.clientSecret) body.set('client_secret', p.clientSecret);
    let json: { id_token?: string; error?: string; error_description?: string };
    try {
      const res = await this.fetcher(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      json = (await res.json()) as typeof json;
      if (!res.ok) throw new Error(json.error_description ?? json.error ?? `HTTP ${res.status}`);
    } catch (e) {
      throw new OidcError('token_exchange_failed', `The provider refused the sign-in (${e instanceof Error ? e.message : 'unreachable'})`);
    }
    if (!json.id_token) throw new OidcError('token_exchange_failed', 'The provider returned no ID token');
    return json.id_token;
  }

  async verifyIdToken(token: string, d: OidcDiscovery, expected: { clientId: string; nonce: string }): Promise<IdTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new OidcError('invalid_id_token', 'Malformed ID token');
    let header: { alg?: string; kid?: string };
    let claims: IdTokenClaims;
    try {
      header = JSON.parse(fromB64url(parts[0]!).toString('utf8')) as typeof header;
      claims = JSON.parse(fromB64url(parts[1]!).toString('utf8')) as IdTokenClaims;
    } catch {
      throw new OidcError('invalid_id_token', 'Malformed ID token');
    }
    if (header.alg !== 'RS256' && header.alg !== 'ES256') throw new OidcError('invalid_id_token', `Unsupported signing algorithm ${header.alg ?? 'none'}`);
    const key = await this.signingKey(d.jwks_uri, header.kid, header.alg);
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = fromB64url(parts[2]!);
    const ok = header.alg === 'RS256' ? verify('RSA-SHA256', data, key, signature) : verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
    if (!ok) throw new OidcError('invalid_id_token', 'The ID token signature is invalid');
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== d.issuer) throw new OidcError('invalid_id_token', 'The ID token is from another issuer');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(expected.clientId)) throw new OidcError('invalid_id_token', 'The ID token is for another application');
    if (typeof claims.exp !== 'number' || claims.exp < now - CLOCK_SKEW_S) throw new OidcError('invalid_id_token', 'The ID token has expired');
    if (claims.iat && claims.iat > now + CLOCK_SKEW_S) throw new OidcError('invalid_id_token', 'The ID token is not valid yet');
    if (claims.nonce !== expected.nonce) throw new OidcError('invalid_id_token', 'The ID token does not belong to this sign-in');
    return claims;
  }

  private async signingKey(jwksUri: string, kid: string | undefined, alg: string): Promise<KeyObject> {
    const pick = (keys: (JsonWebKey & { kid?: string; use?: string })[]) =>
      keys.find((k) => (kid ? k.kid === kid : true) && (k.use === undefined || k.use === 'sig') && (alg === 'RS256' ? k.kty === 'RSA' : k.kty === 'EC'));
    let jwk = pick(await this.keys(jwksUri));
    if (!jwk) jwk = pick(await this.keys(jwksUri, true));
    if (!jwk) throw new OidcError('invalid_id_token', 'The provider has no key for this ID token');
    return createPublicKey({ key: jwk, format: 'jwk' });
  }

  private async keys(uri: string, fresh = false) {
    const cached = this.keySets.get(uri);
    if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.keys;
    try {
      const res = await this.fetcher(uri, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const keys = ((await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] }).keys ?? [];
      this.keySets.set(uri, { at: Date.now(), keys });
      return keys;
    } catch (e) {
      throw new OidcError('invalid_id_token', `Could not read the provider's keys (${e instanceof Error ? e.message : 'unreachable'})`);
    }
  }
}
