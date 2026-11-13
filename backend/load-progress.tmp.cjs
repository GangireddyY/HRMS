require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_MIGRATION_USER || process.env.DB_USER, password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD, database: 'hrms_load' });
  await c.connect();
  for (const t of ['organizations', 'employees', 'employee_salaries', 'attendance_punches', 'attendance_records', 'leave_requests', 'payroll_runs', 'payslips', 'audit_logs']) {
    const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(t.padEnd(20), r.rows[0].n);
  }
  const slow = await c.query(`SELECT round(mean_exec_time::numeric,1) AS ms, calls, left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS q FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 8`).catch((e) => ({ rows: [{ q: 'pg_stat_statements unavailable: ' + e.message }] }));
  for (const s of slow.rows) console.log(s.ms ?? '', s.calls ?? '', s.q);
  const active = await c.query(`SELECT state, now() - query_start AS age, left(regexp_replace(query, '\\s+', ' ', 'g'), 140) AS q FROM pg_stat_activity WHERE datname = 'hrms_load' AND state <> 'idle' ORDER BY age DESC LIMIT 5`);
  for (const a of active.rows) console.log('ACTIVE', a.state, a.age, a.q);
  await c.end();
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
