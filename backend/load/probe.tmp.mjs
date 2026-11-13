import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:3002/api/v1';
const acc = JSON.parse(readFileSync(new URL('./accounts.json', import.meta.url), 'utf8'));
const t = acc.tenants[0];
const login = await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.200.0.1' }, body: JSON.stringify({ email: t.staff[0], password: acc.password }) })).json();
const hrLogin = await (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.200.0.2' }, body: JSON.stringify({ email: t.hr, password: acc.password }) })).json();
const staff = { authorization: `Bearer ${login.data.accessToken}`, 'x-forwarded-for': '10.200.0.1' };
const hr = { authorization: `Bearer ${hrLogin.data.accessToken}`, 'x-forwarded-for': '10.200.0.2' };
const year = new Date().getFullYear();
for (const [who, h, path] of [
  ['staff', staff, `/holidays?year=${year}`],
  ['staff', staff, '/auth/me'],
  ['staff', staff, '/leave/balances'],
  ['staff', staff, '/attendance/today'],
  ['staff', staff, '/notifications/unread-count'],
  ['hr', hr, `/leave/balances/overview?page=1&pageSize=25&year=${year}`],
  ['hr', hr, '/dashboard/approvals'],
  ['hr', hr, '/employees?page=1&pageSize=25'],
]) {
  const times = [];
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    const r = await fetch(`${BASE}${path}`, { headers: h });
    await r.text();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(`${who.padEnd(6)} ${path.padEnd(60)} median ${times[3].toFixed(0)} ms  min ${times[0].toFixed(0)} ms`);
}
