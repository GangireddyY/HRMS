import { BlockList, isIP } from 'node:net';

/** `::ffff:10.0.0.5` (IPv4 seen through an IPv6 socket) → `10.0.0.5`. */
export function normalizeIp(ip: string): string {
  const v = ip.trim();
  return v.toLowerCase().startsWith('::ffff:') && isIP(v.slice(7)) === 4 ? v.slice(7) : v;
}

/** An IP address or a CIDR range (`203.0.113.7`, `203.0.113.0/24`, `2001:db8::/32`), normalized; null when invalid. */
export function parseNetwork(value: string): string | null {
  const [address, prefix, ...rest] = value.trim().split('/');
  if (rest.length || !address) return null;
  const family = isIP(address);
  if (!family) return null;
  if (prefix === undefined) return address.toLowerCase();
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) return null;
  return `${address.toLowerCase()}/${Number(prefix)}`;
}

/** Whether the address is inside any of the networks (invalid entries are ignored). */
export function ipAllowed(ip: string | null | undefined, networks: string[]): boolean {
  if (!ip) return false;
  const address = normalizeIp(ip);
  const family = isIP(address);
  if (!family) return false;
  const list = new BlockList();
  for (const n of networks) {
    const parsed = parseNetwork(n);
    if (!parsed) continue;
    const [a, p] = parsed.split('/') as [string, string | undefined];
    const type = isIP(a) === 4 ? 'ipv4' : 'ipv6';
    if (p === undefined) list.addAddress(a, type);
    else list.addSubnet(a, Number(p), type);
  }
  return list.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
