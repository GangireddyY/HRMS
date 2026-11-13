import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:3002/api/v1';
const acc = JSON.parse(readFileSync(new URL('./accounts.json', import.meta.url), 'utf8'));
const t = acc.tenants[0];
const j = async (path, init = {}) => {
  const r = await fetch(`${BASE}${path}`, init);
  const body = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};
const login = await j('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: t.admin, password: acc.password }) });
const h = { authorization: `Bearer ${login.data.accessToken}`, 'content-type': 'application/json' };
const codes = [];
for (let page = 1; ; page++) {
  const r = await j(`/employees?page=${page}&pageSize=100`, { headers: h });
  codes.push(...r.data.map((e) => e.employeeCode));
  if (page >= r.meta.totalPages) break;
}
const device = (await j('/attendance/devices', { method: 'POST', headers: h, body: JSON.stringify({ name: `Bench ${Date.now()}`, serialNumber: 'BENCH' }) })).data;
const days = [];
for (let d = new Date(); days.length < 30; ) {
  d = new Date(d.getTime() - 86_400_000);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
}
const punches = days.flatMap((day) => codes.map((c) => ({ userCode: c, timestamp: `${day}T09:05:00+05:30`, direction: 'IN' })));
const batches = Array.from({ length: Math.ceil(punches.length / 500) }, (_, i) => punches.slice(i * 500, i * 500 + 500));
const t0 = Date.now();
let next = 0;
let accepted = 0;
await Promise.all(
  [0, 1].map(async () => {
    while (next < batches.length) {
      const b = batches[next++];
      const r = await j('/attendance/device/punches', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': device.apiKey }, body: JSON.stringify({ punches: b }) });
      accepted += r.data.accepted;
    }
  }),
);
const s = (Date.now() - t0) / 1000;
console.log(`${punches.length} punches (${accepted} accepted) in ${s.toFixed(1)}s = ${(punches.length / s).toFixed(0)}/s`);
// The same batches again: all duplicates.
const t1 = Date.now();
const dup = await j('/attendance/device/punches', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': device.apiKey }, body: JSON.stringify({ punches: batches[0] }) });
console.log(`re-sent batch: accepted ${dup.data.accepted}, duplicates ${dup.data.duplicates} in ${Date.now() - t1} ms`);
