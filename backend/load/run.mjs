#!/usr/bin/env node
/**
 * Load test against a running API seeded with `npm run db:seed:load` (sign-ins from load/accounts.json).
 *
 *   LOAD_URL=http://localhost:3002/api/v1 VUS=60 DURATION=90 node load/run.mjs
 *
 * Each virtual user signs in as a real person of a seeded organization (staff, manager, HR or admin; most traffic goes
 * to the large organization) and repeats what their screens load, with think time between requests. Every user
 * comes from its own address (X-Forwarded-For; run the API with TRUST_PROXY=1), as staff on their own connections
 * would, so the per-address rate limit applies per person.
 *
 * Prints latency percentiles per endpoint and writes load/results/<time>.json. Exits 1 when a threshold is missed:
 * overall p95 (P95_MS, 500) and p99 (P99_MS, 1500), any endpoint's p95 (ENDPOINT_P95_MS, 1000), errors (MAX_ERROR_RATE, 0.01).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
// Several URLs (comma-separated) spread the users over API instances, as a load balancer would.
const BASES = (process.env.LOAD_URL ?? 'http://localhost:3002/api/v1').split(',').map((u) => u.trim());
const BASE = BASES.join(', ');
const VUS = env('VUS', 60);
const DURATION = env('DURATION', 90) * 1000;
const RAMP = env('RAMP', 15) * 1000;
const THINK = [env('THINK_MIN_MS', 300), env('THINK_MAX_MS', 1500)];
const LIMITS = { p95: env('P95_MS', 500), p99: env('P99_MS', 1500), endpointP95: env('ENDPOINT_P95_MS', 1000), errorRate: env('MAX_ERROR_RATE', 0.01) };

const accounts = JSON.parse(readFileSync(join(here, 'accounts.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const year = Number(today.slice(0, 4));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What each kind of person's screens request, with relative weights. `:emp` = an employee id of their organization. */
const MIXES = {
  staff: [
    [4, 'GET /auth/me', '/auth/me'],
    [5, 'GET /attendance/today', '/attendance/today'],
    [3, 'GET /leave/balances', '/leave/balances'],
    [4, 'GET /notifications', '/notifications?page=1&pageSize=10'],
    [2, 'GET /notifications/unread-count', '/notifications/unread-count'],
    [2, 'GET /payroll/me/payslips', '/payroll/me/payslips'],
    [2, 'GET /employees/me', '/employees/me'],
    [2, 'GET /attendance/calendar', `/attendance/calendar?month=${month}`],
    [1, 'GET /holidays', `/holidays?year=${year}`],
    [1, 'GET /leave/types', '/leave/types'],
  ],
  manager: [
    [3, 'GET /auth/me', '/auth/me'],
    [4, 'GET /approvals/waiting', '/approvals/waiting'],
    [3, 'GET /leave/requests', '/leave/requests?page=1&pageSize=25&status=PENDING'],
    [3, 'GET /attendance/daily', `/attendance/daily?date=${today}&page=1&pageSize=25`],
    [2, 'GET /employees (search)', '/employees?page=1&pageSize=25&search=Asha'],
    [2, 'GET /leave/calendar', `/leave/calendar?month=${month}`],
    [2, 'GET /dashboard/approvals', '/dashboard/approvals'],
    [2, 'GET /notifications', '/notifications?page=1&pageSize=10'],
  ],
  hr: [
    [3, 'GET /dashboard/approvals', '/dashboard/approvals'],
    [4, 'GET /employees', () => `/employees?page=${1 + Math.floor(Math.random() * 20)}&pageSize=25`],
    [3, 'GET /employees (search)', () => `/employees?page=1&pageSize=25&search=${pick(['Rao', 'Priya', 'E004', 'Sharma', 'Nair'])}`],
    [2, 'GET /employees/:id', '/employees/:emp'],
    [3, 'GET /attendance/daily', `/attendance/daily?date=${today}&page=1&pageSize=25`],
    [2, 'GET /leave/balances/overview', `/leave/balances/overview?page=1&pageSize=25&year=${year}`],
    [2, 'GET /leave/requests', '/leave/requests?page=1&pageSize=25'],
    [1, 'GET /payroll/runs', '/payroll/runs?page=1&pageSize=10'],
    [1, 'GET /reports/headcount', '/reports/headcount'],
    [1, 'GET /payroll/salaries', '/payroll/salaries?page=1&pageSize=25'],
  ],
  admin: [
    [3, 'GET /audit-logs', '/audit-logs?page=1&pageSize=25'],
    [2, 'GET /reports/headcount', '/reports/headcount'],
    [2, 'GET /employees', '/employees?page=1&pageSize=100'],
    [2, 'GET /dashboard/approvals', '/dashboard/approvals'],
    [1, 'GET /roles', '/roles'],
    [1, 'GET /users', '/users?page=1&pageSize=25'],
  ],
};

const stats = new Map();
function record(name, ms, ok, status) {
  const s = stats.get(name) ?? { times: [], errors: 0, statuses: {} };
  s.times.push(ms);
  if (!ok) {
    s.errors++;
    s.statuses[status] = (s.statuses[status] ?? 0) + 1;
  }
  stats.set(name, s);
}

async function timed(base, name, path, init) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
    status = res.status;
    const body = await res.text();
    record(name, performance.now() - t0, res.ok, status);
    return res.ok ? JSON.parse(body) : null;
  } catch (e) {
    record(name, performance.now() - t0, false, e.name === 'TimeoutError' ? 'timeout' : 'network');
    return null;
  }
}

let ipSeq = 0;
async function virtualUser(n, stopAt) {
  await sleep((RAMP * n) / VUS);
  const tenant = n % 10 < 6 ? accounts.tenants[0] : pick(accounts.tenants.slice(1).length ? accounts.tenants.slice(1) : accounts.tenants);
  const roll = Math.random();
  const kind = roll < 0.7 ? 'staff' : roll < 0.85 ? 'manager' : roll < 0.97 ? 'hr' : 'admin';
  const email = kind === 'staff' ? pick(tenant.staff) : kind === 'manager' ? pick(tenant.managers) : tenant[kind];
  ipSeq++;
  const ip = `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
  const url = BASES[n % BASES.length];
  const base = { 'x-forwarded-for': ip, 'user-agent': 'hrms-load' };
  const login = await timed(url, 'POST /auth/login', '/auth/login', { method: 'POST', headers: { ...base, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: accounts.password }) });
  const token = login?.data?.accessToken;
  if (!token) return;
  const headers = { ...base, authorization: `Bearer ${token}` };
  const employees = kind === 'hr' ? ((await timed(url, 'GET /employees', '/employees?page=1&pageSize=50', { headers }))?.data ?? []).map((e) => e.id) : [];
  const mix = MIXES[kind];
  const total = mix.reduce((t, [w]) => t + w, 0);
  while (Date.now() < stopAt) {
    let r = Math.random() * total;
    const [, name, target] = mix.find(([w]) => (r -= w) < 0) ?? mix[0];
    let path = typeof target === 'function' ? target() : target;
    if (path.includes(':emp')) {
      if (!employees.length) continue;
      path = path.replace(':emp', pick(employees));
    }
    await timed(url, name, path, { headers });
    await sleep(THINK[0] + Math.random() * (THINK[1] - THINK[0]));
  }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
function summarise(times) {
  const s = [...times].sort((a, b) => a - b);
  return { count: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.at(-1) ?? 0, mean: s.reduce((a, b) => a + b, 0) / (s.length || 1) };
}

const started = Date.now();
console.log(`Load test: ${VUS} users for ${DURATION / 1000}s (ramp ${RAMP / 1000}s) against ${BASE}`);
await Promise.all(Array.from({ length: VUS }, (_, i) => virtualUser(i, started + RAMP + DURATION)));
const seconds = (Date.now() - started) / 1000;

const all = [...stats.values()].flatMap((s) => s.times);
const errors = [...stats.values()].reduce((n, s) => n + s.errors, 0);
const overall = { ...summarise(all), errors, errorRate: errors / (all.length || 1), rps: all.length / seconds };
const endpoints = [...stats.entries()].map(([name, s]) => ({ name, ...summarise(s.times), errors: s.errors, statuses: s.statuses })).sort((a, b) => b.p95 - a.p95);
const f = (n) => n.toFixed(0).padStart(6);
console.log(`\n${'endpoint'.padEnd(34)} ${'count'.padStart(6)} ${'p50'.padStart(6)} ${'p95'.padStart(6)} ${'p99'.padStart(6)} ${'max'.padStart(6)}  errors`);
for (const e of endpoints) console.log(`${e.name.padEnd(34)} ${String(e.count).padStart(6)} ${f(e.p50)} ${f(e.p95)} ${f(e.p99)} ${f(e.max)}  ${e.errors ? `${e.errors} ${JSON.stringify(e.statuses)}` : ''}`);
console.log(`\nAll: ${overall.count} requests, ${overall.rps.toFixed(1)}/s, p50 ${overall.p50.toFixed(0)} ms, p95 ${overall.p95.toFixed(0)} ms, p99 ${overall.p99.toFixed(0)} ms, errors ${(overall.errorRate * 100).toFixed(2)}%`);

const failures = [
  overall.p95 > LIMITS.p95 && `overall p95 ${overall.p95.toFixed(0)} ms > ${LIMITS.p95}`,
  overall.p99 > LIMITS.p99 && `overall p99 ${overall.p99.toFixed(0)} ms > ${LIMITS.p99}`,
  overall.errorRate > LIMITS.errorRate && `error rate ${(overall.errorRate * 100).toFixed(2)}% > ${LIMITS.errorRate * 100}%`,
  ...endpoints.filter((e) => e.p95 > LIMITS.endpointP95).map((e) => `${e.name} p95 ${e.p95.toFixed(0)} ms > ${LIMITS.endpointP95}`),
].filter(Boolean);
const out = join(here, 'results');
mkdirSync(out, { recursive: true });
const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ base: BASE, vus: VUS, durationSeconds: DURATION / 1000, limits: LIMITS, overall, endpoints, failures }, null, 2));
console.log(failures.length ? `\nFAILED:\n  ${failures.join('\n  ')}` : '\nAll thresholds met.');
console.log(`Results: ${file}`);
process.exitCode = failures.length ? 1 : 0;
