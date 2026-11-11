import { createHash } from 'node:crypto';
import type { AppConfig } from '../../config/app-config.service';
import { redactLinks } from '../mail/mail.service';
import { BreachedPasswordService, countInRange } from './breached-password.service';

const config = (enabled: boolean) => ({ get: () => enabled }) as unknown as AppConfig;
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase();

describe('BreachedPasswordService', () => {
  it('finds the suffix in a padded range response', () => {
    expect(countInRange('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\r\nABCDEF:42', 'ABCDEF')).toBe(42);
    expect(countInRange('00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0', '00D4F6E8FA6EECAD2A3AA415EEC418D38EC')).toBe(0);
    expect(countInRange('', 'ABC')).toBe(0);
  });

  it('sends only the first five characters of the hash', async () => {
    const svc = new BreachedPasswordService(config(true));
    const hash = sha1('password123');
    const prefixes: string[] = [];
    svc.fetchRange = async (prefix) => {
      prefixes.push(prefix);
      return `${hash.slice(5)}:2413945\r\nFFFFF:1`;
    };
    expect(await svc.timesSeen('password123')).toBe(2413945);
    expect(prefixes).toEqual([hash.slice(0, 5)]);
  });

  it('skips the check when it is off or the service is unreachable', async () => {
    const off = new BreachedPasswordService(config(false));
    off.fetchRange = jest.fn();
    expect(await off.timesSeen('x')).toBeNull();
    expect(off.fetchRange).not.toHaveBeenCalled();
    const down = new BreachedPasswordService(config(true));
    down.fetchRange = () => Promise.reject(new Error('timeout'));
    expect(await down.timesSeen('x')).toBeNull();
  });
});

describe('redactLinks', () => {
  it('drops query strings (tokens) from logged links', () => {
    expect(redactLinks('Reset: http://localhost:5173/reset-password?token=abc.def\nThanks')).toBe('Reset: http://localhost:5173/reset-password?[redacted]\nThanks');
    expect(redactLinks('Open https://app.test/leave')).toBe('Open https://app.test/leave');
  });
});
