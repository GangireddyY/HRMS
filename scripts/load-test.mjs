#!/usr/bin/env node
// Load test for the HRMS API (Node 20+, no dependencies). Signs in as one or more users, then keeps CONCURRENCY
// requests in flight over the everyday read endpoints for DURATION seconds and reports latency per endpoint.
//
//   BASE_URL=http://localhost:3100/api/v1 USERS="hr.manager@acme.test,employee@acme.test" PASSWORD=... \
//   CONCURRENCY=50 DURATION=60 node scripts/load-test.mjs
//
// Point it at a staging copy, never at production: the API's per-client rate limit (RATE_LIMIT_PER_MINUTE) must be
// raised there for a single machine to generate load. Exits 1 when p95 latency or the error rate exceeds the budget
// (P95_BUDGET_MS, default 800; ERROR_BUDGET, default 0.01).

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/+$/, '');
const USERS = (process.env.USERS ?? 'hr.manager@acme.test').split(',').map((s) => s.trim()).filter(Boolean);
const PASSWORD = process.env.PASSWORD;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const DURATION = Number(process.env.DURATION ?? 30);
const P95_BUDGET = Number(process.env.P95_BUDGET_MS ?? 800);
const ERROR_BUDGET = Number(process.env.ERROR_BUDGET ?? 0.01);
if (!PASSWORD) {
  console.error('Set PASSWORD (the password of the USERS accounts).');
  process.exit(2);
}

/** Everyday screens: dashboards, people, approvals, attendance, leave, payroll, notifications. */
const ENDPOINTS = [
  ['me', '/auth/me'],
  ['dashboard approvals', '/dashboard/approvals'],
  ['my approvals', '/approvals/waiting'],
  ['employees', '/employees?page=1&pageSize=25'],
  ['employee search', '/employees?page=1&pageSize=10&search=a'],
  ['leave team queue', '/leave/requests?view=team&status=PENDING'],
  ['my leave', '/leave/requests?view=mine'],
  ['leave balances', '/leave/balances/me'],
  ['attendance today', '/attendance/me/today'],
  ['timesheets team', '/attendance/timesheets?view=team'],
  ['notifications', '/notifications?page=1&pageSize=20'],
  ['payroll runs', '/payroll/runs?page=1&pageSize=12'],
  ['claims to approve', '/payroll/reimbursements?view=approve'],
  ['jobs', '/recruitment/jobs?page=1&pageSize=25'],
  ['announcements', '/engagement/announcements?page=1&pageSize=10'],
];

async function signIn(email) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const body = await res.json().catch(() => ({}));
  const token = body?.data?.accessToken;
  if (!res.ok || !token) throw new Error(`Sign-in failed for ${email}: HTTP ${res.status} ${body?.error?.message ?? ''}`);
  return token;
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

async function main() {
  const tokens = [];
  for (const u of USERS) tokens.push(await signIn(u));
  // Endpoints a user's role can't open (403/404) are dropped for that user before the run.
  const usable = [];
  for (const token of tokens) {
    const ok = [];
    for (const [name, path] of ENDPOINTS) {
      const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) ok.push([name, path]);
      await r.arrayBuffer();
    }
    const skipped = ENDPOINTS.filter((e) => !ok.includes(e)).map(([name]) => name);
    if (skipped.length) console.log(`skipped for one user (not allowed or not found): ${skipped.join(', ')}`);
    if (ok.length) usable.push({ token, endpoints: ok });
  }
  if (!usable.length) throw new Error('No endpoint is reachable for these users');
  const stats = new Map();
  const until = Date.now() + DURATION * 1000;
  let sent = 0;
  const worker = async (i) => {
    const u = usable[i % usable.length];
    let n = i;
    while (Date.now() < until) {
      const [name, path] = u.endpoints[n++ % u.endpoints.length];
      const s = stats.get(name) ?? { times: [], errors: 0, statuses: new Map() };
      stats.set(name, s);
      const t0 = performance.now();
      try {
        const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${u.token}` } });
        await r.arrayBuffer();
        if (!r.ok) {
          s.errors++;
          s.statuses.set(r.status, (s.statuses.get(r.status) ?? 0) + 1);
        }
      } catch {
        s.errors++;
      }
      s.times.push(performance.now() - t0);
      sent++;
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  const seconds = (Date.now() - started) / 1000;

  const all = [];
  let errors = 0;
  const rows = [...stats.entries()].map(([name, s]) => {
    const t = [...s.times].sort((a, b) => a - b);
    all.push(...t);
    errors += s.errors;
    return { name, n: t.length, p50: quantile(t, 0.5), p95: quantile(t, 0.95), p99: quantile(t, 0.99), errors: s.errors, statuses: [...s.statuses.entries()].map(([k, v]) => `${k}×${v}`).join(' ') };
  });
  rows.sort((a, b) => b.p95 - a.p95);
  all.sort((a, b) => a - b);
  const pad = (v, w) => String(v).padStart(w);
  console.log(`\n${sent} requests in ${seconds.toFixed(1)} s (${(sent / seconds).toFixed(0)} req/s), ${CONCURRENCY} concurrent, ${USERS.length} user(s)\n`);
  console.log(`${'endpoint'.padEnd(22)}${pad('requests', 9)}${pad('p50 ms', 9)}${pad('p95 ms', 9)}${pad('p99 ms', 9)}${pad('errors', 8)}`);
  for (const r of rows) console.log(`${r.name.padEnd(22)}${pad(r.n, 9)}${pad(r.p50.toFixed(0), 9)}${pad(r.p95.toFixed(0), 9)}${pad(r.p99.toFixed(0), 9)}${pad(r.errors, 8)} ${r.statuses}`);
  const p95 = quantile(all, 0.95);
  const errorRate = sent ? errors / sent : 0;
  console.log(`\nall: p50 ${quantile(all, 0.5).toFixed(0)} ms · p95 ${p95.toFixed(0)} ms · p99 ${quantile(all, 0.99).toFixed(0)} ms · errors ${(errorRate * 100).toFixed(2)}%`);
  const ok = p95 <= P95_BUDGET && errorRate <= ERROR_BUDGET;
  console.log(ok ? `within budget (p95 <= ${P95_BUDGET} ms, errors <= ${ERROR_BUDGET * 100}%)` : `OVER BUDGET (p95 <= ${P95_BUDGET} ms, errors <= ${ERROR_BUDGET * 100}%)`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
