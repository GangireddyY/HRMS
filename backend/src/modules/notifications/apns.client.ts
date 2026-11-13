import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { DeviceGoneError, type NativeMessage } from './fcm.client';

export interface ApnsOptions {
  /** The .p8 signing key from Apple Developer → Keys (Apple Push Notifications service). */
  key: string;
  keyId: string;
  teamId: string;
  /** The app's bundle id. */
  topic: string;
  production: boolean;
}

export type ApnsRequest = (path: string, headers: Record<string, string>, body: string) => Promise<{ status: number; body: string }>;

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Apple Push Notification service over HTTP/2 with token (JWT ES256) authentication, for the iOS app. */
export class ApnsClient {
  private readonly key: KeyObject;
  private jwt: { value: string; issued: number } | null = null;
  private session: ClientHttp2Session | null = null;

  constructor(
    private readonly options: ApnsOptions,
    private readonly request: ApnsRequest = (path, headers, body) => this.http2(path, headers, body),
  ) {
    this.key = createPrivateKey(options.key);
  }

  /** Apple accepts a provider token for an hour and throttles refreshing it more than every 20 minutes. */
  private token(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && now - this.jwt.issued < 50 * 60) return this.jwt.value;
    const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: this.options.keyId }))}.${b64url(JSON.stringify({ iss: this.options.teamId, iat: now }))}`;
    const signature = sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' });
    this.jwt = { value: `${unsigned}.${b64url(signature)}`, issued: now };
    return this.jwt.value;
  }

  async send(deviceToken: string, m: NativeMessage): Promise<void> {
    const body = JSON.stringify({
      aps: { alert: { title: m.title, ...(m.body ? { body: m.body } : {}) }, sound: 'default', 'thread-id': m.tag.split('.')[0] },
      url: m.url ?? '/me/notifications',
      tag: m.tag,
    });
    const res = await this.request(
      `/3/device/${encodeURIComponent(deviceToken)}`,
      {
        authorization: `bearer ${this.token()}`,
        'apns-topic': this.options.topic,
        'apns-push-type': 'alert',
        'apns-priority': '5',
        'apns-collapse-id': m.tag.slice(0, 64),
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
      },
      body,
    );
    if (res.status === 200) return;
    const reason = ((): string | undefined => {
      try {
        return (JSON.parse(res.body) as { reason?: string }).reason;
      } catch {
        return undefined;
      }
    })();
    if (res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') throw new DeviceGoneError(reason ?? String(res.status));
    throw new Error(`Apple rejected the notification (${res.status}${reason ? ` ${reason}` : ''})`);
  }

  private http2(path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
    if (!this.session || this.session.closed || this.session.destroyed) {
      this.session = connect(this.options.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');
      this.session.on('error', () => (this.session = null));
      this.session.unref();
    }
    const session = this.session;
    return new Promise((resolve, reject) => {
      const req = session.request({ [constants.HTTP2_HEADER_METHOD]: 'POST', [constants.HTTP2_HEADER_PATH]: path, 'content-type': 'application/json', ...headers });
      let status = 0;
      let data = '';
      req.setTimeout(10_000, () => req.close(constants.NGHTTP2_CANCEL));
      req.on('response', (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS])));
      req.setEncoding('utf8');
      req.on('data', (c: string) => (data += c));
      req.on('end', () => resolve({ status, body: data }));
      req.on('error', reject);
      req.end(body);
    });
  }
}
