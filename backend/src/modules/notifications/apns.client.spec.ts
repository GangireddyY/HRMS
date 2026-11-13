import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { ApnsClient, type ApnsRequest } from './apns.client';
import { DeviceGoneError } from './fcm.client';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const options = { key: privateKey, keyId: 'ABC123DEFG', teamId: 'TEAM123456', topic: 'com.nitya.hrms', production: false };

describe('APNs client', () => {
  it('sends an alert with a signed ES256 provider token and reuses it', async () => {
    const calls: { path: string; headers: Record<string, string>; body: string }[] = [];
    const request: ApnsRequest = async (path, headers, body) => {
      calls.push({ path, headers, body });
      return { status: 200, body: '' };
    };
    const apns = new ApnsClient(options, request);
    await apns.send('a1b2c3', { title: 'Leave approved', body: '12–14 Nov', url: '/me/leave', tag: 'leave.request_approved' });
    await apns.send('d4e5f6', { title: 'Payslip ready', body: null, url: null, tag: 'payroll.payslip' });

    expect(calls[0]!.path).toBe('/3/device/a1b2c3');
    expect(calls[0]!.headers).toMatchObject({ 'apns-topic': 'com.nitya.hrms', 'apns-push-type': 'alert', 'apns-collapse-id': 'leave.request_approved' });
    expect(JSON.parse(calls[0]!.body)).toEqual({
      aps: { alert: { title: 'Leave approved', body: '12–14 Nov' }, sound: 'default', 'thread-id': 'leave' },
      url: '/me/leave',
      tag: 'leave.request_approved',
    });
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ aps: { alert: { title: 'Payslip ready' } }, url: '/me/notifications' });

    const jwt = calls[0]!.headers.authorization!.replace('bearer ', '');
    expect(calls[1]!.headers.authorization).toBe(`bearer ${jwt}`);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({ iss: 'TEAM123456' });
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'))).toBe(true);
  });

  it('reports unregistered devices separately from other failures', async () => {
    const gone = new ApnsClient(options, async () => ({ status: 410, body: JSON.stringify({ reason: 'Unregistered' }) }));
    await expect(gone.send('old', { title: 'x', body: null, url: null, tag: 't' })).rejects.toBeInstanceOf(DeviceGoneError);
    const bad = new ApnsClient(options, async () => ({ status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) }));
    await expect(bad.send('bad', { title: 'x', body: null, url: null, tag: 't' })).rejects.toBeInstanceOf(DeviceGoneError);
    const busy = new ApnsClient(options, async () => ({ status: 429, body: JSON.stringify({ reason: 'TooManyRequests' }) }));
    await expect(busy.send('ok', { title: 'x', body: null, url: null, tag: 't' })).rejects.toThrow('Apple rejected the notification (429 TooManyRequests)');
  });
});
