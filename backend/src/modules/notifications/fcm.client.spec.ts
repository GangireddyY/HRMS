import { createVerify, generateKeyPairSync } from 'node:crypto';
import { FcmClient, DeviceGoneError } from './fcm.client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const credentials = { project_id: 'hrms-test', client_email: 'push@hrms-test.iam.gserviceaccount.com', private_key: privateKey };

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { http, calls };
}

describe('FCM client', () => {
  it('signs a service-account JWT, caches the access token and sends HTTP v1 messages', async () => {
    const { http, calls } = fakeFetch([
      { status: 200, body: { access_token: 'ya29.token', expires_in: 3600 } },
      { status: 200, body: { name: 'projects/hrms-test/messages/1' } },
      { status: 200, body: { name: 'projects/hrms-test/messages/2' } },
    ]);
    const fcm = new FcmClient(credentials, http);
    await fcm.send('device-1', { title: 'Leave approved', body: '12–14 Nov', url: '/me/leave', tag: 'leave.request_approved' });
    await fcm.send('device-2', { title: 'Payslip ready', body: null, url: null, tag: 'payroll.payslip' });

    expect(calls).toHaveLength(3);
    const assertion = new URLSearchParams(calls[0]!.init.body as URLSearchParams).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);

    expect(calls[1]!.url).toBe('https://fcm.googleapis.com/v1/projects/hrms-test/messages:send');
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.token');
    const message = JSON.parse(calls[1]!.init.body as string).message;
    expect(message).toMatchObject({ token: 'device-1', notification: { title: 'Leave approved', body: '12–14 Nov' }, data: { url: '/me/leave', tag: 'leave.request_approved' } });
    expect(JSON.parse(calls[2]!.init.body as string).message).toMatchObject({ notification: { title: 'Payslip ready' }, data: { url: '/me/notifications' } });
  });

  it('reports gone tokens separately from other failures', async () => {
    const token = { status: 200, body: { access_token: 't', expires_in: 3600 } };
    const gone = new FcmClient(credentials, fakeFetch([token, { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }]).http);
    await expect(gone.send('old', { title: 'x', body: null, url: null, tag: 't' })).rejects.toBeInstanceOf(DeviceGoneError);
    const busy = new FcmClient(credentials, fakeFetch([token, { status: 503, body: { error: { status: 'UNAVAILABLE' } } }]).http);
    await expect(busy.send('ok', { title: 'x', body: null, url: null, tag: 't' })).rejects.toThrow('Firebase rejected the message (503 UNAVAILABLE)');
  });
});
