/**
 * Load-test data (`npm run db:seed:load`): one large organization and several smaller ones, built through the real
 * API (validation, workflows, audit) from a local server started by this script. Each gets departments, a manager per
 * department, employees imported by CSV, a salary for everyone, weeks of attendance pushed through the device API,
 * leave requests (some approved) and an approved payroll run. Sign-ins for the load runner are written to
 * `load/accounts.json`.
 *
 * Only runs against a database whose name ends in `_load` (DB_NAME=hrms_load), never in production.
 * Sizes: LOAD_LARGE_EMPLOYEES (1000), LOAD_TENANTS (10 more organizations), LOAD_EMPLOYEES (100 each),
 * LOAD_DAYS (30 working days of attendance, at most 40).
 */
import 'reflect-metadata';
import { loadEnvFile, refuseDemoDataInProduction } from './env-file';
loadEnvFile();
refuseDemoDataInProduction('db:seed:load');

import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { addDays, addMonths, zonedParts } from '../common/utils/zoned-time';
import { DatabaseService } from './database.service';
import { MembershipRole, Organization, OrganizationMembership, Plan, User } from './models';
import { PasswordHasher } from '../infrastructure/crypto/password-hasher.service';
import { MailService } from '../infrastructure/mail/mail.service';
import { createUserWithPassword, seedPlans } from '../infrastructure/seed/platform-bootstrap';
import { OrganizationProvisioningService } from '../modules/organizations/organization-provisioning.service';

export const LOAD_PASSWORD = 'Load@Hrms2026';
const TZ = 'Asia/Kolkata';
const RAW = { skipTenantScope: true } as const;
const logger = new Logger('LoadSeed');
const num = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);
const LARGE = num('LOAD_LARGE_EMPLOYEES', 1000);
const TENANTS = num('LOAD_TENANTS', 10);
const EACH = num('LOAD_EMPLOYEES', 100);
const DAYS = Math.min(num('LOAD_DAYS', 30), 40);

if (!/_load$/.test(process.env.DB_NAME ?? '')) {
  console.error('Refusing to seed load data: DB_NAME must end in _load (e.g. DB_NAME=hrms_load), so a real database is never touched.');
  process.exit(1);
}

// ---- HTTP against the local server --------------------------------------------------------------------------------

let base = '';
type Json = Record<string, any>;
async function request(method: string, path: string, headers: Record<string, string>, body?: unknown, form?: FormData): Promise<Json | null> {
  const h: Record<string, string> = { 'user-agent': 'hrms-load-seed', ...headers };
  if (body !== undefined && !form) h['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers: h, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as Json) : null;
}
const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown, form?: FormData): Promise<any> => (await request(method, path, headers, body, form))?.data ?? null;
class As {
  constructor(private readonly token: string) {}
  private get h() {
    return { authorization: `Bearer ${this.token}` };
  }
  get = (path: string) => call('GET', path, this.h);
  /** A list endpoint: its items and paging. */
  page = async (path: string) => {
    const res = await request('GET', path, this.h);
    return { items: (res?.data ?? []) as Json[], meta: res?.meta as { totalPages: number } };
  };
  post = (path: string, body: unknown = {}) => call('POST', path, this.h, body);
  upload = (path: string, name: string, content: string) => {
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/csv' }), name);
    return call('POST', path, this.h, undefined, form);
  };
}
async function login(email: string): Promise<As> {
  const data = await call('POST', '/auth/login', {}, { email, password: LOAD_PASSWORD });
  if (data.status !== 'AUTHENTICATED') throw new Error(`Login for ${email} needs ${data.status}`);
  return new As(data.accessToken);
}

/** Runs `fn` over `items`, `width` at a time. */
async function pool<T>(items: T[], width: number, fn: (item: T, i: number) => Promise<unknown>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

// ---- Dates ----------------------------------------------------------------------------------------------------------

const today = zonedParts(new Date(), TZ).date;
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isWorkday = (d: string) => weekday(d) !== 0 && weekday(d) !== 6;
function workdays(n: number, from: string, step: 1 | -1): string[] {
  const out: string[] = [];
  for (let d = addDays(from, step); out.length < n; d = addDays(d, step)) if (isWorkday(d)) out.push(d);
  return step === -1 ? out.reverse() : out;
}
const prevMonth = addMonths(`${today.slice(0, 7)}-01`, -1);

// ---- One organization ---------------------------------------------------------------------------------------------

const DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'Finance', 'Operations', 'Customer Success', 'People', 'Product'];
const DESIGNATIONS = ['Associate', 'Senior Associate', 'Specialist', 'Lead', 'Manager', 'Senior Manager', 'Director', 'Analyst'];
const FIRST = ['Asha', 'Ravi', 'Priya', 'Karthik', 'Meera', 'Arjun', 'Divya', 'Rohan', 'Sneha', 'Vikram', 'Ananya', 'Rahul', 'Kavya', 'Siddharth', 'Neha', 'Aditya'];
const LAST = ['Rao', 'Sharma', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Menon', 'Patel', 'Das', 'Kulkarni', 'Singh', 'Joshi'];

interface Deps {
  db: DatabaseService;
  hasher: PasswordHasher;
  provisioning: OrganizationProvisioningService;
}

interface TenantAccounts {
  organization: string;
  employees: number;
  admin: string;
  hr: string;
  managers: string[];
  staff: string[];
}

async function account(deps: Deps, orgId: string, roles: Map<string, string>, email: string, first: string, last: string, roleKeys: string[]) {
  const user = await createUserWithPassword(deps.hasher, { email, firstName: first, lastName: last, password: LOAD_PASSWORD });
  const membership = await OrganizationMembership.create({ organizationId: orgId, userId: user.id, status: 'ACTIVE', joinedAt: new Date() }, RAW);
  await MembershipRole.bulkCreate(roleKeys.map((k) => ({ organizationId: orgId, membershipId: membership.id, roleId: roles.get(k)! })), RAW);
  return { user, membership };
}

async function seedTenant(deps: Deps, index: number, size: number): Promise<TenantAccounts> {
  const slug = `t${String(index).padStart(2, '0')}`;
  const name = `Load ${slug.toUpperCase()} ${index === 0 ? 'Enterprises' : 'Pvt Ltd'}`;
  const started = Date.now();
  if (await Organization.findOne({ where: { name }, ...RAW })) throw new Error(`${name} exists: seed a fresh _load database`);
  const plan = await Plan.findOne({ where: { code: 'enterprise' }, rejectOnEmpty: true });
  const { organization, roleIdsByKey } = await deps.db.transaction((transaction) =>
    deps.provisioning.provision(transaction, { name, planId: plan.id, status: 'ACTIVE', industry: 'Information Technology', companySize: size > 500 ? '1001-5000' : '51-200', email: `hr@${slug}.load.test` }),
  );
  const orgId = organization.id;
  const email = (local: string) => `${local}@${slug}.load.test`;

  // Admin first (it creates everything else), then structure, then people.
  await account(deps, orgId, roleIdsByKey, email('admin'), 'Load', 'Admin', ['org_admin']);
  const a = await login(email('admin'));
  const departments = new Map<string, string>();
  for (const d of DEPARTMENTS) departments.set(d, (await a.post('/departments', { name: d })).id);
  const designations = new Map<string, string>();
  for (const [i, d] of DESIGNATIONS.entries()) designations.set(d, (await a.post('/designations', { name: d, level: i + 1 })).id);
  await a.post('/attendance/shifts', { name: 'General', startTime: '09:30', endTime: '18:30', isDefault: true });
  await a.post('/leave/types/recommended');

  const joined = '2024-04-01';
  const person = async (local: string, first: string, last: string, roleKeys: string[], extra: Json) => {
    const { membership } = await account(deps, orgId, roleIdsByKey, email(local), first, last, roleKeys);
    return a.post('/employees', { firstName: first, lastName: last, workEmail: email(local), gender: 'FEMALE', dateOfBirth: '1990-06-15', dateOfJoining: joined, employmentType: 'FULL_TIME', membershipId: membership.id, ...extra });
  };
  await person('hr', 'Hema', 'Rao', ['hr_manager', 'payroll_manager'], { employeeCode: 'H0001', departmentId: departments.get('People'), designationId: designations.get('Manager') });
  await account(deps, orgId, roleIdsByKey, email('finance'), 'Farhan', 'Ali', ['finance_manager']);
  const managers: { code: string; department: string; email: string }[] = [];
  for (const [i, d] of DEPARTMENTS.entries()) {
    const code = `M${String(i + 1).padStart(4, '0')}`;
    await person(`manager${i + 1}`, FIRST[i % FIRST.length]!, LAST[i % LAST.length]!, ['team_lead', 'employee'], { employeeCode: code, departmentId: departments.get(d), designationId: designations.get('Manager') });
    managers.push({ code, department: d, email: email(`manager${i + 1}`) });
  }
  // People who sign in (load runner employees): one in ten, up to 50, each reporting to their department's manager.
  const staffCount = Math.min(50, Math.max(5, Math.floor(size / 10)));
  const staff: string[] = [];
  const managerIds = new Map<string, string>();
  for (const m of (await a.page('/employees?pageSize=100&search=M0')).items) managerIds.set(m.employeeCode, m.id);
  for (let i = 0; i < staffCount; i++) {
    const m = managers[i % managers.length]!;
    await person(`staff${i + 1}`, FIRST[(i + 3) % FIRST.length]!, LAST[(i + 5) % LAST.length]!, ['employee'], {
      employeeCode: `S${String(i + 1).padStart(4, '0')}`,
      departmentId: departments.get(m.department),
      designationId: designations.get(DESIGNATIONS[i % 4]!),
      managerId: managerIds.get(m.code) ?? null,
    });
    staff.push(email(`staff${i + 1}`));
  }

  // Everyone else through the CSV import.
  const imported = Math.max(0, size - staffCount - managers.length - 1);
  const header = 'employee_code,first_name,last_name,work_email,date_of_joining,gender,date_of_birth,department,designation,manager_code';
  const rows = Array.from({ length: imported }, (_, i) => {
    const m = managers[i % managers.length]!;
    return [`E${String(i + 1).padStart(5, '0')}`, FIRST[i % FIRST.length], `${LAST[(i * 7) % LAST.length]}${i}`, `e${i + 1}@${slug}.load.test`, joined, i % 2 ? 'MALE' : 'FEMALE', '1992-01-20', m.department, DESIGNATIONS[i % 4], m.code].join(',');
  });
  if (rows.length) {
    const result = await a.upload('/employees/import', 'employees.csv', [header, ...rows].join('\r\n'));
    if (result.created !== rows.length) throw new Error(`Import created ${result.created} of ${rows.length}: ${JSON.stringify(result.errors?.slice(0, 3))}`);
  }

  // Employee ids and codes (paged), then a salary for everyone.
  const everyone: { id: string; employeeCode: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await a.page(`/employees?page=${page}&pageSize=100`);
    everyone.push(...(res.items as { id: string; employeeCode: string }[]));
    if (page >= res.meta.totalPages) break;
  }
  // The admin has no employee record, so nobody sets their own salary (which the API refuses).
  const hrAs = await login(email('hr'));
  const standard = ((await a.post('/payroll/structures/recommended')).structures as { id: string; name: string }[]).find((s) => s.name === 'Standard')!;
  await pool(everyone, 8, (e, i) => a.post(`/payroll/employees/${e.id}/salaries`, { structureId: standard.id, annualCtc: 480_000 + (i % 20) * 60_000, effectiveFrom: joined, reason: 'Joining' }));

  // Attendance: device punches for the last DAYS working days (09:2x in, 18:3x out), in batches of 500.
  const device = await a.post('/attendance/devices', { name: 'Main gate', serialNumber: `LOAD-${slug}` });
  const punches = workdays(DAYS, today, -1).flatMap((day, d) =>
    everyone.flatMap((e, i) => {
      if ((i + d) % 23 === 0) return [];
      const inMin = 15 + ((i + d) % 20);
      const outMin = 30 + ((i * 3 + d) % 25);
      return [
        { userCode: e.employeeCode, timestamp: `${day}T09:${String(inMin).padStart(2, '0')}:00+05:30`, direction: 'IN' },
        { userCode: e.employeeCode, timestamp: `${day}T18:${String(outMin).padStart(2, '0')}:00+05:30`, direction: 'OUT' },
      ];
    }),
  );
  const batches = Array.from({ length: Math.ceil(punches.length / 500) }, (_, i) => punches.slice(i * 500, i * 500 + 500));
  const punchStart = Date.now();
  await pool(batches, 2, (batch) => call('POST', '/attendance/device/punches', { 'x-device-key': device.apiKey }, { punches: batch }));
  const punchSeconds = (Date.now() - punchStart) / 1000;

  // Leave: each signed-in employee asks for a day in the coming weeks; managers approve every other one.
  const types = (await a.get('/leave/types')) as { id: string; code: string }[];
  const casual = (types.find((t) => t.code === 'CL') ?? types[0])!.id;
  const ahead = workdays(30, today, 1);
  const requests: { id: string; i: number }[] = [];
  await pool(staff, 4, async (s, i) => {
    const day = ahead[(i * 3) % ahead.length]!;
    const req = await (await login(s)).post('/leave/requests', { leaveTypeId: casual, startDate: day, endDate: day, reason: 'Family function' });
    requests.push({ id: req.id, i });
  });
  for (const r of requests.filter((x) => x.i % 2 === 0)) await (await login(managers[r.i % managers.length]!.email)).post(`/leave/requests/${r.id}/approve`, { note: 'Enjoy' }).catch(() => undefined);

  // Last month's payroll: calculated, submitted, approved by finance.
  const { year, month } = { year: Number(prevMonth.slice(0, 4)), month: Number(prevMonth.slice(5, 7)) };
  const runStart = Date.now();
  const run = await hrAs.post('/payroll/runs', { year, month });
  const runSeconds = (Date.now() - runStart) / 1000;
  await hrAs.post(`/payroll/runs/${run.id}/submit`);
  await (await login(email('finance'))).post(`/payroll/runs/${run.id}/approve`);

  console.log(
    `  ${name}: ${everyone.length} employees, ${punches.length} punches in ${punchSeconds.toFixed(0)}s, payroll for ${everyone.length} in ${runSeconds.toFixed(1)}s (total ${((Date.now() - started) / 1000).toFixed(0)}s)`,
  );
  return { organization: name, employees: everyone.length, admin: email('admin'), hr: email('hr'), managers: managers.map((m) => m.email), staff };
}

async function main(): Promise<void> {
  // The seed signs in many users from one address; rate limits stay in force for the server under test.
  ThrottlerGuard.prototype.canActivate = async () => true;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  app.get(MailService).send = async () => undefined;
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  try {
    await seedPlans();
    const deps: Deps = { db: app.get(DatabaseService), hasher: app.get(PasswordHasher), provisioning: app.get(OrganizationProvisioningService) };
    console.log(`Seeding ${TENANTS + 1} organizations (${LARGE} + ${TENANTS} × ${EACH} employees, ${DAYS} days of attendance)…`);
    const tenants: TenantAccounts[] = [];
    tenants.push(await seedTenant(deps, 0, LARGE));
    for (let i = 1; i <= TENANTS; i++) tenants.push(await seedTenant(deps, i, EACH));
    const dir = join(__dirname, '..', '..', 'load');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ password: LOAD_PASSWORD, createdAt: new Date().toISOString(), tenants }, null, 2));
    console.log(`Done: ${tenants.reduce((n, t) => n + t.employees, 0)} employees. Sign-ins written to load/accounts.json.`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
