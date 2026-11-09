import { describe, expect, it } from 'vitest';
import { statusLabel } from './status';
import { timezoneOptions } from './options';

describe('statusLabel', () => {
  it('turns API enums into readable labels', () => {
    expect(statusLabel('ACTIVE')).toBe('Active');
    expect(statusLabel('MFA_CHALLENGE')).toBe('MFA challenge');
    expect(statusLabel('DEACTIVATED')).toBe('Deactivated');
    expect(statusLabel(null)).toBe('—');
  });
});

describe('timezoneOptions', () => {
  it('always offers canonical zones and the saved value', () => {
    const values = timezoneOptions('Etc/GMT+5').map((o) => o.value);
    expect(values).toContain('Asia/Kolkata');
    expect(values).toContain('Etc/GMT+5');
    expect(new Set(values).size).toBe(values.length);
  });
});
import { describeUserAgent, humanize } from '@/shared/utils/format';
import { changedFields, type ProfileFields } from '@/modules/organization/utils/profile';
import { safeRedirect } from '@/shared/utils/redirect';

describe('safeRedirect', () => {
  it('accepts relative paths', () => {
    expect(safeRedirect('/admin/users?page=2')).toBe('/admin/users?page=2');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeRedirect('https://evil.example')).toBeNull();
    expect(safeRedirect('//evil.example')).toBeNull();
    expect(safeRedirect('/\\evil.example')).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });
});

describe('format helpers', () => {
  it('describes user agents', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130 Safari/537')).toBe('Chrome on Windows');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile Safari/604.1')).toBe('Safari on iOS');
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(describeUserAgent(null)).toBe('Unknown device');
  });

  it('humanizes keys', () => {
    expect(humanize('role.permissions_updated')).toBe('Role Permissions Updated');
  });
});

describe('changedFields', () => {
  it('returns only modified fields and sends cleared values as empty strings', () => {
    const before = { name: 'Acme', city: 'Pune', website: 'https://acme.test' } as unknown as ProfileFields;
    const after = { name: 'Acme', city: 'Mumbai', website: '' } as unknown as ProfileFields;
    expect(changedFields(before, after)).toEqual({ city: 'Mumbai', website: '' });
  });
});
