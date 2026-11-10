import { ipAllowed, normalizeIp, parseNetwork } from './networks';

describe('office networks', () => {
  it('parses addresses and CIDR ranges', () => {
    expect(parseNetwork(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(parseNetwork('203.0.113.0/24')).toBe('203.0.113.0/24');
    expect(parseNetwork('2001:DB8::/32')).toBe('2001:db8::/32');
    expect(parseNetwork('203.0.113.0/33')).toBeNull();
    expect(parseNetwork('office wifi')).toBeNull();
    expect(parseNetwork('10.0.0.0/8/1')).toBeNull();
  });

  it('matches addresses inside the ranges, including IPv4 through IPv6 sockets', () => {
    const office = ['203.0.113.0/24', '198.51.100.9', '2001:db8::/32'];
    expect(ipAllowed('203.0.113.200', office)).toBe(true);
    expect(ipAllowed('::ffff:203.0.113.5', office)).toBe(true);
    expect(ipAllowed('198.51.100.9', office)).toBe(true);
    expect(ipAllowed('198.51.100.10', office)).toBe(false);
    expect(ipAllowed('2001:db8:1::5', office)).toBe(true);
    expect(ipAllowed('2001:db9::5', office)).toBe(false);
    expect(ipAllowed(undefined, office)).toBe(false);
    expect(normalizeIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
  });
});
