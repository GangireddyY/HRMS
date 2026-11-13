import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface FcmCredentials {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface NativeMessage {
  title: string;
  body: string | null;
  url: string | null;
  tag: string;
}

/** The device's push token is no longer valid (app uninstalled, token rotated): drop it. Used for FCM and APNs. */
export class DeviceGoneError extends Error {}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function readFcmCredentials(file: string): FcmCredentials {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Partial<FcmCredentials>;
  if (!json.project_id || !json.client_email || !json.private_key) throw new Error(`${file} is not a Firebase service-account key (project_id, client_email, private_key)`);
  return json as FcmCredentials;
}

/**
 * Firebase Cloud Messaging HTTP v1: Android directly, iOS through APNs (configured in the Firebase project). Signs
 * a service-account JWT for an OAuth access token (cached until shortly before it expires).
 */
export class FcmClient {
  private token: { value: string; expires: number } | null = null;

  constructor(
    private readonly credentials: FcmCredentials,
    private readonly http: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expires - 60 > now) return this.token.value;
    const uri = this.credentials.token_uri ?? 'https://oauth2.googleapis.com/token';
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: this.credentials.client_email, scope: SCOPE, aud: uri, iat: now, exp: now + 3600 }))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.credentials.private_key);
    const res = await this.http(uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
    });
    if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expires: now + body.expires_in };
    return body.access_token;
  }

  async send(deviceToken: string, m: NativeMessage): Promise<void> {
    const res = await this.http(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.credentials.project_id)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: m.title, ...(m.body ? { body: m.body } : {}) },
          data: { url: m.url ?? '/me/notifications', tag: m.tag },
          android: { priority: 'NORMAL', ttl: '3600s', notification: { tag: m.tag } },
          apns: { headers: { 'apns-collapse-id': m.tag.slice(0, 64), 'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600) } },
        },
      }),
    });
    if (res.ok) return;
    const error = ((await res.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } }).error;
    const code = error?.details?.find((d) => d.errorCode)?.errorCode ?? error?.status;
    if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT')) throw new DeviceGoneError(code ?? String(res.status));
    throw new Error(`Firebase rejected the message (${res.status}${code ? ` ${code}` : ''})`);
  }
}
