/**
 * Demo data (`npm run db:seed:demo`): three organizations — one per subscription plan — with a user for every role
 * and realistic data in every module the plan includes. Everything after the accounts is created through the real API
 * (validation, permissions, workflows, audit), from a local server started by this script; nothing is emailed.
 *
 * Idempotent per organization: a demo organization that already exists is left as it is. All demo users share the
 * password below. Run `npm run db:seed` first (plans, Super Admin).
 */
import 'reflect-metadata';
import { loadEnvFile } from './env-file';
loadEnvFile();

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { addDays, addMonths, zonedParts } from '../common/utils/zoned-time';
import { DEFAULT_MERIT_MATRIX } from '../contracts';
import { DatabaseService } from './database.service';
import { runDemoExtras } from './demo-extras/index';
import { createKit, demoOrganizationId } from './demo-extras/kit';
import { Employee, MembershipRole, Organization, OrganizationMembership, Plan, User } from './models';
import { PasswordHasher } from '../infrastructure/crypto/password-hasher.service';
import { MailService } from '../infrastructure/mail/mail.service';
import { createUserWithPassword, seedPlans } from '../infrastructure/seed/platform-bootstrap';
import { OrganizationProvisioningService } from '../modules/organizations/organization-provisioning.service';

export const DEMO_PASSWORD = 'Demo@Hrms2026';
const TZ = 'Asia/Kolkata';
const RAW = { skipTenantScope: true } as const;
const logger = new Logger('DemoSeed');

// ---- Small HTTP client against the local server -----------------------------------------------------------------

let base = '';
type Json = Record<string, any>;

async function call(method: string, path: string, token: string | null, body?: unknown, form?: FormData): Promise<any> {
  const headers: Record<string, string> = { 'user-agent': 'hrms-demo-seed' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as Json).data : null;
}

class As {
  constructor(readonly token: string) {}
  get = (path: string) => call('GET', path, this.token);
  post = (path: string, body: unknown = {}) => call('POST', path, this.token, body);
  put = (path: string, body: unknown) => call('PUT', path, this.token, body);
  patch = (path: string, body: unknown) => call('PATCH', path, this.token, body);
  upload = (path: string, fields: Record<string, string>, file: { data: Buffer; name: string; type: string }) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
    return call('POST', path, this.token, undefined, form);
  };
}

async function login(email: string): Promise<As> {
  const data = await call('POST', '/auth/login', null, { email, password: DEMO_PASSWORD });
  if (data.status !== 'AUTHENTICATED') throw new Error(`Login for ${email} needs ${data.status}`);
  return new As(data.accessToken);
}

const problems: string[] = [];
/** Runs one part of the demo; a failure is reported at the end without stopping the rest. */
async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    problems.push(`${label}: ${message}`);
    logger.warn(`✗ ${label}: ${message}`);
  }
}

// ---- Dates (organization time zone) -----------------------------------------------------------------------------

const today = zonedParts(new Date(), TZ).date;
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isWorkday = (d: string) => weekday(d) !== 0 && weekday(d) !== 6;
/** The last `n` working days before today, oldest first. */
function recentWorkdays(n: number): string[] {
  const out: string[] = [];
  for (let d = addDays(today, -1); out.length < n; d = addDays(d, -1)) if (isWorkday(d)) out.unshift(d);
  return out;
}
/** Monday `weeks` weeks from the coming one. */
function mondayIn(weeks: number): string {
  let d = addDays(today, 1);
  while (weekday(d) !== 1) d = addDays(d, 1);
  return addDays(d, weeks * 7);
}
const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
const prevMonth = addMonths(firstOfMonth(today), -1);
const nextMonth = addMonths(firstOfMonth(today), 1);
const ym = (d: string) => ({ year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) });
const fyStart = Number(today.slice(5, 7)) >= 4 ? `${today.slice(0, 4)}-04-01` : `${Number(today.slice(0, 4)) - 1}-04-01`;
const iso = (d: Date) => d.toISOString();

/** A one-page PDF (receipts, resumes) that file-type checks accept. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

// ---- Organizations and people -----------------------------------------------------------------------------------

interface PersonSpec {
  key: string;
  first: string;
  last: string;
  email: string;
  roles: string[];
  department?: string;
  designation?: string;
  location?: string;
  manager?: string;
  gender: 'MALE' | 'FEMALE';
  born: string;
  joined: string;
  ctc: number;
  phone?: string;
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
}

interface Person extends PersonSpec {
  userId: string;
  employeeId: string;
  as: As;
}

interface OrgCtx {
  id: string;
  name: string;
  plan: string;
  admin: Person;
  people: Map<string, Person>;
  departments: Map<string, string>;
  designations: Map<string, string>;
  locations: Map<string, string>;
  p: (key: string) => Person;
}

interface Deps {
  db: DatabaseService;
  hasher: PasswordHasher;
  provisioning: OrganizationProvisioningService;
}

async function createOrganization(deps: Deps, spec: { name: string; plan: string; industry: string; size: string; email: string }) {
  const plan = await Plan.findOne({ where: { code: spec.plan }, rejectOnEmpty: true });
  return deps.db.transaction((transaction) =>
    deps.provisioning.provision(transaction, { name: spec.name, planId: plan.id, status: 'ACTIVE', industry: spec.industry, companySize: spec.size, email: spec.email }),
  );
}

/** A user account with its organization membership and roles, signed in. */
async function addAccount(deps: Deps, org: { id: string; roles: Map<string, string> }, s: PersonSpec) {
  const existing = await User.findOne({ where: { email: s.email } });
  // A reused account may come from an older run with another password, or be locked by failed sign-ins.
  if (existing) await existing.update({ passwordHash: await deps.hasher.hash(DEMO_PASSWORD), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' });
  const user = existing ?? (await createUserWithPassword(deps.hasher, { email: s.email, firstName: s.first, lastName: s.last, password: DEMO_PASSWORD }));
  const membership = await OrganizationMembership.create({ organizationId: org.id, userId: user.id, status: 'ACTIVE', joinedAt: new Date() }, RAW);
  const roleIds = s.roles.map((k) => org.roles.get(k)).filter((x): x is string => !!x);
  await MembershipRole.bulkCreate(roleIds.map((roleId) => ({ organizationId: org.id, membershipId: membership.id, roleId })), RAW);
  return { user, membership, as: await login(s.email) };
}

async function addPerson(
  deps: Deps,
  org: { id: string; roles: Map<string, string> },
  adminAs: As | null,
  ctx: Omit<OrgCtx, 'admin' | 'p'>,
  s: PersonSpec,
  account?: Awaited<ReturnType<typeof addAccount>>,
): Promise<Person> {
  const { user, membership, as } = account ?? (await addAccount(deps, org, s));
  const creator = adminAs ?? as;
  const employee = await creator.post('/employees', {
    firstName: s.first,
    lastName: s.last,
    workEmail: s.email,
    phone: s.phone ?? null,
    gender: s.gender,
    dateOfBirth: s.born,
    dateOfJoining: s.joined,
    employmentType: s.employmentType ?? 'FULL_TIME',
    departmentId: s.department ? ctx.departments.get(s.department) : null,
    designationId: s.designation ? ctx.designations.get(s.designation) : null,
    locationId: s.location ? ctx.locations.get(s.location) : null,
    managerId: s.manager ? ctx.people.get(s.manager)!.employeeId : null,
    membershipId: membership.id,
  });
  const person: Person = { ...s, userId: user.id, employeeId: employee.id, as };
  ctx.people.set(s.key, person);
  return person;
}

/** Departments, designations, locations, holidays, a default shift, then the people (managers first). */
async function buildOrganization(
  deps: Deps,
  spec: { name: string; plan: string; industry: string; size: string; email: string },
  structure: { departments: string[]; designations: string[]; locations: { name: string; city: string; state: string }[] },
  people: PersonSpec[],
): Promise<OrgCtx | null> {
  // By name, or through the admin's membership when the organization was renamed in Settings.
  const byAdmin = await demoOrganizationId(deps.db, people[0]!.email);
  const existing = (await Organization.findOne({ where: { name: spec.name } })) ?? (byAdmin ? await Organization.findByPk(byAdmin) : null);
  if (existing) {
    if (await Employee.count({ where: { organizationId: existing.id }, ...RAW })) {
      console.log(`${spec.name} already exists — left as it is`);
      return null;
    }
    // No employees: an earlier run stopped before the people were created, so its logins never worked.
    try {
      await deps.db.transaction((transaction) => Organization.destroy({ where: { id: existing.id }, transaction, ...RAW }));
    } catch (e) {
      throw new Error(`${spec.name} exists without employees and could not be removed (${e instanceof Error ? e.message : String(e)}); use a fresh database`);
    }
    console.log(`${spec.name} existed without employees — recreating it`);
  }
  const { organization, roleIdsByKey } = await createOrganization(deps, spec);
  const org = { id: organization.id, roles: roleIdsByKey };
  const ctx = { id: organization.id, name: spec.name, plan: spec.plan, people: new Map<string, Person>(), departments: new Map<string, string>(), designations: new Map<string, string>(), locations: new Map<string, string>() };

  // The admin's account comes first (it creates everything else), then the structure, then everyone's records.
  const [adminSpec, ...rest] = people;
  const adminAccount = await addAccount(deps, org, adminSpec!);
  const a = adminAccount.as;
  for (const name of structure.departments) ctx.departments.set(name, (await a.post('/departments', { name })).id);
  for (const [i, name] of structure.designations.entries()) ctx.designations.set(name, (await a.post('/designations', { name, level: i + 1 })).id);
  for (const l of structure.locations) ctx.locations.set(l.name, (await a.post('/locations', { name: l.name, city: l.city, state: l.state, country: 'IN', timezone: TZ })).id);
  const admin = await addPerson(deps, org, a, ctx, adminSpec!, adminAccount);
  for (const s of rest) await addPerson(deps, org, a, ctx, s);
  console.log(`${spec.name} (${spec.plan} plan): ${people.length} people`);
  return { ...ctx, admin, p: (key: string) => ctx.people.get(key)! };
}

// ---- Module data ------------------------------------------------------------------------------------------------

async function seedCalendar(o: OrgCtx) {
  const year = Number(today.slice(0, 4));
  const holidays = [
    { date: `${year}-10-02`, name: 'Gandhi Jayanti' },
    { date: `${year}-12-25`, name: 'Christmas' },
    { date: `${year + 1}-01-01`, name: 'New Year' },
    { date: `${year + 1}-01-26`, name: 'Republic Day' },
    { date: `${year + 1}-03-04`, name: 'Holi', isOptional: true },
  ];
  for (const h of holidays) await o.admin.as.post('/holidays', h);
  await o.admin.as.post('/attendance/shifts', { name: 'General', startTime: '09:30', endTime: '18:30', isDefault: true, overtimeEnabled: true, overtimeAfterMinutes: 540, overtimeMinMinutes: 30 });
}

/** Ten days of attendance for everyone (a few late arrivals, one long day with overtime), and punches today. */
async function seedAttendance(o: OrgCtx, opts: { skip?: Record<string, string[]>; overtime?: { person: string; day: number } }) {
  const days = recentWorkdays(10);
  let n = 0;
  for (const person of o.people.values()) {
    for (const [i, day] of days.entries()) {
      if (day < person.joined || opts.skip?.[person.key]?.includes(day)) continue;
      n++;
      const late = (n * 7) % 11 === 0;
      const checkIn = late ? '10:05' : ['09:18', '09:25', '09:31', '09:22'][n % 4]!;
      const long = opts.overtime?.person === person.key && opts.overtime.day === i;
      const checkOut = long ? '21:00' : ['18:35', '18:42', '19:05', '18:31'][n % 4]!;
      await o.admin.as.put('/attendance/records', { employeeId: person.employeeId, workDate: day, checkIn, checkOut, note: long ? 'Release support' : 'Imported from the access system' });
    }
  }
  if (isWorkday(today)) {
    for (const person of [...o.people.values()].slice(0, 6)) if (person.joined <= today) await person.as.post('/attendance/punch-in', {}).catch(() => null);
  }
}

async function seedLeave(o: OrgCtx, requests: { who: string; type: string; start: string; end: string; reason: string; approve?: boolean; reject?: string }[]) {
  await o.admin.as.put('/leave/settings', { leaveYearStartMonth: 4 });
  await o.admin.as.post('/leave/types/recommended');
  const types = (await o.admin.as.get('/leave/types')) as { id: string; code: string }[];
  const type = (code: string) => types.find((t) => t.code === code)!.id;
  for (const r of requests) {
    const person = o.p(r.who);
    const created = await person.as.post('/leave/requests', { leaveTypeId: type(r.type), startDate: r.start, endDate: r.end, reason: r.reason });
    const approver = person.manager ? o.p(person.manager).as : o.admin.as;
    if (r.approve) await approver.post(`/leave/requests/${created.id}/approve`, { note: 'Approved — enjoy!' });
    if (r.reject) await approver.post(`/leave/requests/${created.id}/reject`, { note: r.reject });
  }
}

let panSeq = 0;
/** Statutory and bank details (fake but well-formed), then a salary for everyone. */
async function seedSalaries(o: OrgCtx, payroll: Person) {
  const structures = (await o.admin.as.post('/payroll/structures/recommended')).structures as { id: string; name: string }[];
  const standard = structures.find((s) => s.name === 'Standard')!;
  for (const person of o.people.values()) {
    panSeq++;
    const letters = (n: number) => String.fromCharCode(65 + (n % 26));
    await o.admin.as.put(`/employees/${person.employeeId}/sensitive`, {
      pan: `ABC${letters(panSeq)}${letters(panSeq * 7)}${String(1000 + panSeq).slice(-4)}${letters(panSeq * 3)}`,
      uan: `1009${String(10_000_000 + panSeq * 7919).slice(-8)}`,
      bankAccountNumber: `5010${String(100_000_000 + panSeq * 104_729).slice(-8)}`,
      bankIfsc: 'HDFC0001234',
      bankName: 'HDFC Bank',
    });
    const effectiveFrom = person.joined > fyStart ? person.joined : fyStart;
    // Nobody sets their own salary.
    const by = person.userId === o.admin.userId ? payroll.as : o.admin.as;
    await by.post(`/payroll/employees/${person.employeeId}/salaries`, { structureId: standard.id, annualCtc: person.ctc, effectiveFrom, reason: 'Annual compensation' });
  }
}

/** Last month's payroll: worked out by payroll, submitted, approved and paid by finance; published to employees. */
async function seedPayrollRun(o: OrgCtx, payroll: Person, finance: Person, opts: { pay: boolean }) {
  const { year, month } = ym(prevMonth);
  const run = await payroll.as.post('/payroll/runs', { year, month });
  await payroll.as.post(`/payroll/runs/${run.id}/submit`);
  await finance.as.post(`/payroll/runs/${run.id}/approve`, { note: 'Variance checked against last month' });
  if (opts.pay) await finance.as.post(`/payroll/runs/${run.id}/pay`, { paymentReference: `NEFT-${year}${String(month).padStart(2, '0')}30` });
}

// ---- Acme Technologies (Enterprise: every module) ---------------------------------------------------------------

const ACME: PersonSpec[] = [
  { key: 'admin', first: 'Aarav', last: 'Mehta', email: 'admin@acme.test', roles: ['org_admin'], department: 'Operations', designation: 'Director', location: 'Bengaluru HQ', gender: 'MALE', born: '1980-03-14', joined: '2019-04-01', ctc: 4_800_000, phone: '+91 98450 10001' },
  { key: 'hrDirector', first: 'Kavita', last: 'Rao', email: 'hr.director@acme.test', roles: ['hr_director'], department: 'Human Resources', designation: 'Director', location: 'Bengaluru HQ', manager: 'admin', gender: 'FEMALE', born: '1982-07-22', joined: '2019-06-03', ctc: 3_600_000 },
  { key: 'hrManager', first: 'Neha', last: 'Sharma', email: 'hr.manager@acme.test', roles: ['hr_manager'], department: 'Human Resources', designation: 'HR Manager', location: 'Bengaluru HQ', manager: 'hrDirector', gender: 'FEMALE', born: '1988-01-09', joined: '2020-08-17', ctc: 2_000_000 },
  { key: 'hrExec', first: 'Rohan', last: 'Das', email: 'hr.executive@acme.test', roles: ['hr_executive'], department: 'Human Resources', designation: 'HR Executive', location: 'Bengaluru HQ', manager: 'hrManager', gender: 'MALE', born: '1995-11-30', joined: '2022-02-01', ctc: 800_000 },
  { key: 'recruiter', first: 'Simran', last: 'Kaur', email: 'recruiter@acme.test', roles: ['recruiter'], department: 'Human Resources', designation: 'Recruiter', location: 'Bengaluru HQ', manager: 'hrManager', gender: 'FEMALE', born: '1994-05-18', joined: '2021-09-13', ctc: 1_000_000 },
  { key: 'payroll', first: 'Vikram', last: 'Iyer', email: 'payroll@acme.test', roles: ['payroll_manager'], department: 'Finance', designation: 'Payroll Manager', location: 'Bengaluru HQ', manager: 'admin', gender: 'MALE', born: '1986-09-02', joined: '2020-01-06', ctc: 1_800_000 },
  { key: 'finance', first: 'Anita', last: 'Desai', email: 'finance@acme.test', roles: ['finance_manager'], department: 'Finance', designation: 'Finance Manager', location: 'Bengaluru HQ', manager: 'admin', gender: 'FEMALE', born: '1984-12-11', joined: '2019-11-04', ctc: 2_400_000 },
  { key: 'engManager', first: 'Rajesh', last: 'Kumar', email: 'eng.manager@acme.test', roles: ['department_manager'], department: 'Engineering', designation: 'Engineering Manager', location: 'Bengaluru HQ', manager: 'admin', gender: 'MALE', born: '1983-04-25', joined: '2019-05-06', ctc: 4_000_000 },
  { key: 'teamLead', first: 'Priya', last: 'Nair', email: 'team.lead@acme.test', roles: ['team_lead'], department: 'Engineering', designation: 'Team Lead', location: 'Bengaluru HQ', manager: 'engManager', gender: 'FEMALE', born: '1989-08-16', joined: '2020-03-02', ctc: 2_800_000 },
  { key: 'salesManager', first: 'Arjun', last: 'Singh', email: 'sales.manager@acme.test', roles: ['department_manager'], department: 'Sales', designation: 'Sales Manager', location: 'Pune Office', manager: 'admin', gender: 'MALE', born: '1985-02-03', joined: '2020-06-15', ctc: 2_600_000 },
  { key: 'auditor', first: 'Meera', last: 'Joshi', email: 'auditor@acme.test', roles: ['auditor'], department: 'Finance', designation: 'Internal Auditor', location: 'Bengaluru HQ', manager: 'finance', gender: 'FEMALE', born: '1987-10-07', joined: '2023-01-09', ctc: 1_500_000 },
  { key: 'asha', first: 'Asha', last: 'Patel', email: 'employee@acme.test', roles: ['employee'], department: 'Engineering', designation: 'Senior Software Engineer', location: 'Bengaluru HQ', manager: 'teamLead', gender: 'FEMALE', born: '1992-05-10', joined: '2021-07-05', ctc: 2_200_000, phone: '+91 98450 20002' },
  { key: 'karthik', first: 'Karthik', last: 'Reddy', email: 'karthik@acme.test', roles: ['employee'], department: 'Engineering', designation: 'Software Engineer', location: 'Bengaluru HQ', manager: 'engManager', gender: 'MALE', born: '1996-03-21', joined: '2022-08-01', ctc: 1_400_000 },
  { key: 'divya', first: 'Divya', last: 'Menon', email: 'divya@acme.test', roles: ['employee'], department: 'Engineering', designation: 'Software Engineer', location: 'Bengaluru HQ', manager: 'teamLead', gender: 'FEMALE', born: '1997-06-12', joined: '2023-02-13', ctc: 1_200_000 },
  { key: 'pooja', first: 'Pooja', last: 'Bhat', email: 'pooja@acme.test', roles: ['employee'], department: 'Engineering', designation: 'Software Engineer', location: 'Bengaluru HQ', manager: 'teamLead', gender: 'FEMALE', born: '1998-09-28', joined: '2024-01-15', ctc: 1_000_000 },
  { key: 'nikhil', first: 'Nikhil', last: 'Jain', email: 'nikhil@acme.test', roles: ['employee'], department: 'Engineering', designation: 'Senior Software Engineer', location: 'Bengaluru HQ', manager: 'engManager', gender: 'MALE', born: '1990-12-01', joined: '2020-10-05', ctc: 2_100_000 },
  { key: 'farhan', first: 'Farhan', last: 'Ali', email: 'farhan@acme.test', roles: ['employee'], department: 'Sales', designation: 'Sales Executive', location: 'Pune Office', manager: 'salesManager', gender: 'MALE', born: '1995-01-17', joined: '2022-04-04', ctc: 900_000 },
  { key: 'sneha', first: 'Sneha', last: 'Gupta', email: 'sneha@acme.test', roles: ['employee'], department: 'Sales', designation: 'Sales Executive', location: 'Pune Office', manager: 'salesManager', gender: 'FEMALE', born: '1996-07-04', joined: '2023-06-19', ctc: 850_000 },
  { key: 'manoj', first: 'Manoj', last: 'Verma', email: 'manoj@acme.test', roles: ['employee'], department: 'Operations', designation: 'Operations Executive', location: 'Bengaluru HQ', manager: 'admin', gender: 'MALE', born: '1993-04-08', joined: '2021-11-22', ctc: 650_000 },
  { key: 'gautam', first: 'Gautam', last: 'Sinha', email: 'former.employee@acme.test', roles: ['employee'], department: 'Engineering', designation: 'Software Engineer', location: 'Bengaluru HQ', manager: 'engManager', gender: 'MALE', born: '1994-08-19', joined: '2021-01-11', ctc: 1_300_000 },
  { key: 'intern', first: 'Ishaan', last: 'Malhotra', email: 'intern@acme.test', roles: ['employee'], department: 'Engineering', designation: 'Software Engineer', location: 'Bengaluru HQ', manager: 'teamLead', gender: 'MALE', born: '2003-02-14', joined: addDays(today, -20), ctc: 360_000, employmentType: 'INTERN' },
];

async function seedAcme(deps: Deps): Promise<void> {
  const o = await buildOrganization(
    deps,
    { name: 'Acme Technologies', plan: 'enterprise', industry: 'Information Technology', size: '201-1000', email: 'people@acme.test' },
    {
      departments: ['Engineering', 'Sales', 'Human Resources', 'Finance', 'Operations'],
      designations: ['Software Engineer', 'Senior Software Engineer', 'Team Lead', 'Engineering Manager', 'Sales Executive', 'Sales Manager', 'HR Executive', 'Recruiter', 'HR Manager', 'Payroll Manager', 'Finance Manager', 'Internal Auditor', 'Operations Executive', 'Director'],
      locations: [
        { name: 'Bengaluru HQ', city: 'Bengaluru', state: 'Karnataka' },
        { name: 'Pune Office', city: 'Pune', state: 'Maharashtra' },
      ],
    },
    ACME,
  );
  if (!o) return;
  const { p } = o;
  const days = recentWorkdays(10);

  await step('Acme: holidays and shift', () => seedCalendar(o));
  // Karthik: a missed punch (regularization) and a sick day, so no attendance on those days.
  await step('Acme: attendance', () => seedAttendance(o, { skip: { karthik: [days[7]!, days[6]!] }, overtime: { person: 'asha', day: 8 } }));
  await step('Acme: regularization and work from home', async () => {
    await p('karthik').as.post('/attendance/regularizations', { workDate: days[7], checkIn: '09:20', checkOut: '18:40', reason: 'Badge reader was down at the main gate' });
    await p('pooja').as.post('/attendance/work-from-home', { startDate: mondayIn(1), endDate: addDays(mondayIn(1), 1), reason: 'Internet installation at the new flat' });
    const approved = await p('divya').as.post('/attendance/work-from-home', { startDate: addDays(mondayIn(0), 2), endDate: addDays(mondayIn(0), 2), reason: 'Plumber visit' });
    await p('teamLead').as.post(`/attendance/work-from-home/${approved.id}/approve`, { note: 'Fine, stay reachable on chat' });
  });
  await step('Acme: leave', () =>
    seedLeave(o, [
      { who: 'asha', type: 'CL', start: mondayIn(2), end: addDays(mondayIn(2), 1), reason: 'Cousin’s wedding in Mysuru' },
      { who: 'karthik', type: 'SL', start: days[6]!, end: days[6]!, reason: 'Fever', approve: true },
      { who: 'divya', type: 'EL', start: mondayIn(3), end: addDays(mondayIn(3), 2), reason: 'Family trip to Kerala', approve: true },
      { who: 'farhan', type: 'CL', start: addDays(mondayIn(1), 3), end: addDays(mondayIn(1), 3), reason: 'Bank work' },
      { who: 'sneha', type: 'CL', start: addDays(mondayIn(0), 4), end: addDays(mondayIn(0), 4), reason: 'Personal errand', reject: 'Quarter-end client visits that day — please pick another date' },
      { who: 'manoj', type: 'EL', start: mondayIn(4), end: addDays(mondayIn(4), 4), reason: 'Visiting parents' },
    ]),
  );
  await step('Acme: payroll structures, statutory details and salaries', () => seedSalaries(o, p('payroll')));
  await step('Acme: last month’s payroll (approved and paid)', () => seedPayrollRun(o, p('payroll'), p('finance'), { pay: true }));
  await step('Acme: reimbursements', async () => {
    const claim = (who: string, category: string, title: string, amount: number, expenseDate: string) =>
      p(who).as.upload('/payroll/reimbursements', { category, title, amount: String(amount), expenseDate }, { data: PDF, name: 'receipt.pdf', type: 'application/pdf' });
    await claim('asha', 'TRAVEL', 'Cab to client office', 1450, days[6]!);
    const approved = await claim('farhan', 'TRAVEL', 'Train to Mumbai for the Reliance demo', 3200, days[2]!);
    await p('payroll').as.post(`/payroll/reimbursements/${approved.id}/approve`, { note: 'Receipt matches' });
    await claim('sneha', 'FOOD', 'Client lunch', 2100, days[8]!);
  });
  await step('Acme: loans and salary advances', async () => {
    const { year, month } = ym(nextMonth);
    await p('karthik').as.post('/payroll/me/loans', { type: 'LOAN', amount: 150000, tenureMonths: 12, purpose: 'Two-wheeler purchase' });
    const advance = await p('divya').as.post('/payroll/me/loans', { type: 'ADVANCE', amount: 30000, tenureMonths: 3, purpose: 'Medical emergency in the family' });
    await p('finance').as.post(`/payroll/loans/${advance.id}/approve`, { startYear: year, startMonth: month, note: 'Approved' });
    await p('payroll').as.post(`/payroll/loans/${advance.id}/disburse`, { disbursedOn: today, reference: `IMPS${today.replace(/-/g, '')}01` });
  });

  await step('Acme: recruitment, offer and hire with onboarding', async () => {
    await p('hrManager').as.post('/onboarding/templates/recommended');
    const req = await p('engManager').as.post('/recruitment/requisitions', {
      title: 'Backend Engineer', designationId: o.designations.get('Software Engineer'), reason: 'NEW_ROLE', justification: 'Scaling the payments platform team for the new UPI product', openings: 2, budgetMin: 1_200_000, budgetMax: 1_800_000, submit: true,
    });
    await p('hrManager').as.post(`/recruitment/requisitions/${req.id}/approve`, { note: 'Budget confirmed with finance' });
    const job = await p('recruiter').as.post('/recruitment/jobs', { requisitionId: req.id, description: 'Build and run payment services in TypeScript and PostgreSQL. You will own APIs end to end, from design to on-call.', isPublic: true });
    await p('recruiter').as.post(`/recruitment/jobs/${job.id}/status`, { status: 'OPEN' });
    const candidate = (first: string, last: string, extra: Json) => p('recruiter').as.post('/recruitment/candidates', { firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@candidates.test`, jobId: job.id, ...extra });
    const stage = (appId: string, s: string) => p('recruiter').as.post(`/recruitment/applications/${appId}/stage`, { stage: s });

    await candidate('Sanjay', 'Rao', { phone: '+91 90000 22222', experienceYears: 2, source: 'CAREERS', currentCompany: 'Infosys', currentTitle: 'Systems Engineer', skills: ['Java', 'SQL'] });
    const ravi = await candidate('Ravi', 'Kumar', { phone: '+91 98765 43210', experienceYears: 4.5, source: 'LINKEDIN', currentCompany: 'Flipkart', currentTitle: 'Software Engineer', skills: ['TypeScript', 'Node.js', 'PostgreSQL'] });
    await stage(ravi.applications[0].id, 'SCREENING');
    const interview = await p('recruiter').as.post(`/recruitment/applications/${ravi.applications[0].id}/interviews`, { roundName: 'Technical round', scheduledAt: iso(new Date(Date.now() - 26 * 3_600_000)), panelistIds: [p('teamLead').employeeId] });
    const mine = (await p('teamLead').as.get('/recruitment/my-interviews')) as { id: string }[];
    if (mine[0]) await p('teamLead').as.post(`/recruitment/interviews/${mine[0].id}/feedback`, { rating: 4, recommendation: 'HIRE', feedback: 'Strong system design; clear about trade-offs in idempotent payment APIs.' });
    void interview;
    const lata = await candidate('Lata', 'Pillai', { phone: '+91 90000 33333', experienceYears: 6, source: 'JOB_BOARD', currentCompany: 'Razorpay', currentTitle: 'Senior Engineer' });
    await stage(lata.applications[0].id, 'SCREENING');
    await p('recruiter').as.post(`/recruitment/applications/${lata.applications[0].id}/interviews`, { roundName: 'System design', scheduledAt: iso(new Date(Date.now() + 2 * 86_400_000)), panelistIds: [p('engManager').employeeId, p('teamLead').employeeId] });

    const meera = await candidate('Meera', 'Iyer', { phone: '+91 90000 11111', experienceYears: 3, source: 'LINKEDIN', currentCompany: 'Zoho', currentTitle: 'Developer' });
    await stage(meera.applications[0].id, 'OFFER');
    const offer = await p('recruiter').as.post(`/recruitment/applications/${meera.applications[0].id}/offers`, { annualCtc: 1_500_000, joiningDate: mondayIn(2), expiresOn: addDays(today, 7) });
    await p('recruiter').as.post(`/recruitment/offers/${offer.id}/release`);
    await p('recruiter').as.post(`/recruitment/offers/${offer.id}/response`, { response: 'ACCEPTED' });
    await p('hrManager').as.post(`/recruitment/offers/${offer.id}/hire`, { startOnboarding: true });

    await p('salesManager').as.post('/recruitment/requisitions', { title: 'Inside Sales Executive', designationId: o.designations.get('Sales Executive'), reason: 'REPLACEMENT', justification: 'Backfill for a sales executive who moved to the Mumbai team', openings: 1, submit: true });
  });
  await step('Acme: onboarding for the intern', async () => {
    const started = await p('hrManager').as.post('/onboarding/cases', { employeeId: p('intern').employeeId, buddyId: p('asha').employeeId });
    const mine = (started.tasks as { id: string; assignee: string; documentCategory: string | null }[]).filter((t) => t.assignee === 'EMPLOYEE' && !t.documentCategory).slice(0, 2);
    for (const t of mine) await p('intern').as.post(`/onboarding/tasks/${t.id}/complete`);
  });

  await step('Acme: performance cycle, reviews and a salary-increase recommendation', async () => {
    const competencies = [
      { key: 'communication', name: 'Communication' },
      { key: 'ownership', name: 'Ownership' },
      { key: 'collaboration', name: 'Collaboration' },
    ];
    const year = Number(fyStart.slice(0, 4));
    const cycle = await p('hrManager').as.post('/performance/cycles', { name: `Annual review ${year}-${String(year + 1).slice(2)}`, periodStart: fyStart, periodEnd: addDays(addMonths(fyStart, 12), -1), goalsWeight: 70, competencies });
    await p('hrManager').as.post(`/performance/cycles/${cycle.id}/launch`);
    const reviewOf = async (who: Person) => ((await who.as.get('/performance/reviews?view=mine')) as { id: string; employee: { id: string } }[]).find((r) => r.employee.id === who.employeeId)!.id;

    // Karthik: the full review, completed by his manager.
    const k = p('karthik');
    const kid = await reviewOf(k);
    await k.as.post(`/performance/reviews/${kid}/goals`, { title: 'Ship the settlement reconciliation service', measure: 'Live for all merchants with < 0.1% mismatches', weight: 60 });
    const kr = await k.as.post(`/performance/reviews/${kid}/goals`, { title: 'Cut p95 API latency by 30%', measure: 'From 420 ms to under 300 ms', weight: 40 });
    await k.as.post(`/performance/reviews/${kid}/goals/submit`);
    await p('engManager').as.post(`/performance/reviews/${kid}/goals/approve`);
    const [g1, g2] = kr.goals as { id: string }[];
    await k.as.put(`/performance/reviews/${kid}/self-assessment`, { goals: [{ goalId: g1!.id, rating: 4, comment: 'Shipped in Q2' }, { goalId: g2!.id, rating: 4 }], competencies: competencies.map((c) => ({ key: c.key, rating: 4 })), comment: 'A productive year with two big launches', submit: true });
    await p('engManager').as.put(`/performance/reviews/${kid}/manager-review`, { goals: [{ goalId: g1!.id, rating: 4 }, { goalId: g2!.id, rating: 4 }], competencies: competencies.map((c) => ({ key: c.key, rating: 4 })), strengths: 'Reliable delivery and calm under incidents', improvements: 'Share knowledge through more design reviews', submit: true });

    // Asha: goals approved, self-review open. Pooja: goals still to submit.
    const a = p('asha');
    const aid = await reviewOf(a);
    await a.as.post(`/performance/reviews/${aid}/goals`, { title: 'Lead the payments API v2 migration', measure: 'All partners moved by Q4', weight: 50 });
    await a.as.post(`/performance/reviews/${aid}/goals`, { title: 'Mentor two new joiners', measure: 'Both confirmed after probation', weight: 30 });
    await a.as.post(`/performance/reviews/${aid}/goals`, { title: 'Improve test coverage to 85%', weight: 20 });
    await a.as.post(`/performance/reviews/${aid}/goals/submit`);
    await p('teamLead').as.post(`/performance/reviews/${aid}/goals/approve`);
    const pid = await reviewOf(p('pooja'));
    await p('pooja').as.post(`/performance/reviews/${pid}/goals`, { title: 'Own the notifications service', weight: 100 });

    // Increments: guidelines from HR, a recommendation from Karthik's manager waiting for approval.
    await p('hrManager').as.put(`/performance/cycles/${cycle.id}/compensation`, { meritMatrix: DEFAULT_MERIT_MATRIX, budgetPercent: 9, effectiveFrom: nextMonth });
    const hike = await p('engManager').as.put(`/performance/reviews/${kid}/hike`, { percent: 10, promotion: false });
    await p('engManager').as.post(`/performance/hikes/${hike.recommendation.id}/submit`);
  });
  await step('Acme: improvement plan', async () => {
    await p('salesManager').as.post('/performance/pips', {
      employeeId: p('sneha').employeeId,
      reason: 'Pipeline coverage has been below 2× the quarterly target for two quarters.',
      objectives: [{ title: 'Build pipeline to 3× target', measure: 'Weekly CRM review' }, { title: 'Two client demos per week' }],
      startDate: today,
      endDate: addDays(today, 60),
    });
  });

  await step('Acme: training courses and enrolments', async () => {
    const hr = p('hrManager').as;
    const security = await hr.post('/training/courses', { code: 'SEC-101', title: 'Information security basics', category: 'COMPLIANCE', delivery: 'SELF_PACED', contentUrl: 'https://learn.example.com/security', durationHours: 1, mandatory: true, selfEnrollment: true });
    await hr.post(`/training/courses/${security.id}/publish`);
    const ts = await hr.post('/training/courses', { code: 'TS-201', title: 'Advanced TypeScript', category: 'TECHNICAL', delivery: 'SELF_PACED', contentUrl: 'https://learn.example.com/ts', durationHours: 6, selfEnrollment: true });
    await hr.post(`/training/courses/${ts.id}/publish`);
    const leaders = await hr.post('/training/courses', { code: 'LEAD-1', title: 'First-time managers', category: 'LEADERSHIP', delivery: 'CLASSROOM', durationHours: 6, selfEnrollment: false });
    await hr.post(`/training/courses/${leaders.id}/publish`);
    const start = new Date(`${mondayIn(1)}T04:30:00Z`);
    await hr.post(`/training/courses/${leaders.id}/sessions`, { startsAt: iso(start), endsAt: iso(new Date(start.getTime() + 6 * 3_600_000)), location: 'Bengaluru HQ — Board room', trainer: 'Kavita Rao', capacity: 12 });
    for (const who of ['asha', 'karthik', 'divya']) {
      const e = await p(who).as.post(`/training/courses/${security.id}/enroll`);
      await p(who).as.post(`/training/enrollments/${e.id}/start`);
      if (who !== 'divya') await p(who).as.post(`/training/enrollments/${e.id}/done`);
    }
    const tsEnrol = await p('asha').as.post(`/training/courses/${ts.id}/enroll`);
    await p('asha').as.post(`/training/enrollments/${tsEnrol.id}/start`);
  });
  await step('Acme: skill matrix', async () => {
    const hr = p('hrManager').as;
    const skill = async (name: string, category: string) => (await hr.post('/skills', { name, category })).id as string;
    const tsId = await skill('TypeScript', 'TECHNICAL');
    const sql = await skill('PostgreSQL', 'TECHNICAL');
    const sysDesign = await skill('System design', 'TECHNICAL');
    const comms = await skill('Communication', 'SOFT');
    await skill('Negotiation', 'SOFT');
    await skill('Excel', 'TOOL');
    for (const d of ['Software Engineer', 'Senior Software Engineer']) {
      await hr.put(`/skills/requirements/${o.designations.get(d)}`, { skills: [{ skillId: tsId, level: d === 'Software Engineer' ? 3 : 4 }, { skillId: sql, level: 3 }, { skillId: sysDesign, level: d === 'Software Engineer' ? 2 : 4 }, { skillId: comms, level: 3 }] });
    }
    const rate = (who: string, list: [string, number][]) => Promise.all(list.map(([skillId, level]) => p(who).as.put('/skills/me/profile', { skillId, level })));
    await rate('asha', [[tsId, 4], [sql, 3], [sysDesign, 3], [comms, 4]]);
    await rate('karthik', [[tsId, 3], [sql, 4], [comms, 3]]);
    await rate('divya', [[tsId, 2], [sql, 2]]);
    await p('engManager').as.post(`/skills/employees/${p('asha').employeeId}/${tsId}/verify`, { level: 4 });
  });

  await step('Acme: announcements, survey, recognition and suggestions', async () => {
    const hr = p('hrManager').as;
    const policy = await hr.post('/engagement/announcements', { title: 'New code review policy', body: 'From Monday every change needs two approvals, including one from outside your squad.', category: 'POLICY', requiresAck: true, departmentIds: [o.departments.get('Engineering')] });
    await hr.post(`/engagement/announcements/${policy.id}/publish`);
    await p('asha').as.post(`/engagement/announcements/${policy.id}/acknowledge`);
    const townHall = await hr.post('/engagement/announcements', { title: 'Q3 town hall', body: 'Quarterly results, the 2027 roadmap and an open Q&A with the leadership team.', category: 'EVENT', eventStartsAt: iso(new Date(`${addDays(mondayIn(0), 3)}T10:30:00Z`)), eventLocation: 'Bengaluru HQ cafeteria and online', pinned: true });
    await hr.post(`/engagement/announcements/${townHall.id}/publish`);
    for (const who of ['asha', 'karthik', 'farhan']) await p(who).as.post(`/engagement/announcements/${townHall.id}/rsvp`, { response: 'GOING' });
    const welcome = await hr.post('/engagement/announcements', { title: 'Welcome Ishaan!', body: 'Ishaan joins the payments team as an intern. Say hello!', category: 'CELEBRATION' });
    await hr.post(`/engagement/announcements/${welcome.id}/publish`);

    const survey = await hr.post('/engagement/surveys', {
      title: 'Quarterly pulse check',
      questions: [
        { type: 'RATING', prompt: 'How happy are you at work?' },
        { type: 'NPS', prompt: 'How likely are you to recommend Acme as an employer?' },
        { type: 'CHOICE', prompt: 'Which perk matters most to you?', options: ['Hybrid work', 'Learning budget', 'Health cover'], required: false },
        { type: 'TEXT', prompt: 'What should we improve?', required: false },
      ],
    });
    await hr.post(`/engagement/surveys/${survey.id}/open`);
    const q = survey.questions as { id: string }[];
    // Choice answers are the option's index.
    const answers: [string, number, number, number, string][] = [
      ['asha', 4, 9, 0, 'More focus time'],
      ['karthik', 5, 10, 1, ''],
      ['divya', 3, 7, 0, 'Faster laptop refresh'],
      ['farhan', 4, 8, 2, ''],
      ['manoj', 4, 8, 2, 'Better cafeteria food'],
    ];
    for (const [who, rating, nps, choice, text] of answers) {
      await p(who).as.post(`/engagement/surveys/${survey.id}/responses`, { answers: { [q[0]!.id]: rating, [q[1]!.id]: nps, [q[2]!.id]: choice, ...(text ? { [q[3]!.id]: text } : {}) } });
    }
    await p('asha').as.post('/engagement/recognitions', { recipientIds: [p('karthik').employeeId, p('divya').employeeId], badge: 'TEAMWORK', message: 'Thanks for staying late to get the settlement release out on time!' });
    await p('engManager').as.post('/engagement/recognitions', { recipientIds: [p('asha').employeeId], badge: 'OWNERSHIP', message: 'Led the API v2 migration plan end to end.' });
    await p('farhan').as.post('/engagement/suggestions', { title: 'Standing desks', body: 'A few standing desks on each floor would help with back pain on long days.', category: 'WORKPLACE' });
    await p('divya').as.post('/engagement/suggestions', { title: 'Meeting-free Wednesdays', body: 'Keeping Wednesdays free of meetings would give everyone a focus day.', category: 'CULTURE', anonymous: true });
  });

  await step('Acme: grievance', async () => {
    const g = await p('manoj').as.post('/grievances', { category: 'WORKPLACE', subject: 'Air conditioning on the 3rd floor', description: 'The air conditioning on the third floor has not worked properly for two weeks and the afternoons are very hot for the operations team.' });
    await p('hrManager').as.post(`/grievances/${g.id}/assign`, { assigneeUserId: p('hrManager').userId });
    await p('hrManager').as.post(`/grievances/${g.id}/notes`, { body: 'Facilities has raised a ticket with the vendor; a technician visits on Monday.' });
    await p('farhan').as.post('/grievances', { category: 'PAY_BENEFITS', subject: 'Travel allowance not received', description: 'My travel allowance for the Mumbai client visit last month has not been paid yet even though the claim was approved.' });
  });

  await step('Acme: benefits', async () => {
    const asha = p('asha');
    const dependents: string[] = [];
    for (const [name, relationship, dateOfBirth] of [['Rahul Patel', 'SPOUSE', '1990-02-01'], ['Anaya Patel', 'CHILD', '2019-06-15']] as const) {
      dependents.push((await o.admin.as.post(`/employees/${asha.employeeId}/family`, { name, relationship, dateOfBirth, isDependent: true })).id);
    }
    const plan = await p('hrManager').as.post('/benefits/plans', {
      name: `Group health ${today.slice(0, 4)}`,
      type: 'HEALTH',
      provider: 'Star Health',
      policyNumber: `GMC-${today.slice(0, 4)}-001`,
      coverageStartsOn: fyStart,
      coverageEndsOn: addDays(addMonths(fyStart, 12), -1),
      enrollmentOpensOn: addDays(today, -3),
      enrollmentClosesOn: addDays(today, 21),
      employmentTypes: ['FULL_TIME'],
      maxChildAge: 25,
      options: [
        { name: 'Employee only', coverageAmount: 300000, employeeMonthly: 0, employerMonthly: 500, allowedRelations: [], maxDependents: 0 },
        { name: 'Family', coverageAmount: 500000, employeeMonthly: 750, employerMonthly: 1500, allowedRelations: ['SPOUSE', 'CHILD'], maxDependents: 3 },
      ],
    });
    await p('hrManager').as.post(`/benefits/plans/${plan.id}/activate`);
    const [solo, family] = plan.options as { id: string }[];
    await asha.as.post(`/benefits/plans/${plan.id}/enroll`, { optionId: family!.id, dependentIds: dependents });
    await p('karthik').as.post(`/benefits/plans/${plan.id}/enroll`, { optionId: solo!.id, dependentIds: [] });
    await p('divya').as.post(`/benefits/plans/${plan.id}/waive`, { note: 'Covered under my spouse’s policy' });
  });

  await step('Acme: policies and statutory calendar', async () => {
    const hr = p('hrManager').as;
    const coc = await hr.post('/compliance/policies', { title: 'Code of conduct', category: 'CODE_OF_CONDUCT', summary: 'How we work together and with customers', ackDueDays: 14, reviewMonths: 12, content: 'Treat everyone with respect. Avoid conflicts of interest. Protect customer data. Report concerns without fear of retaliation.' });
    await hr.post(`/compliance/policies/${coc.id}/publish`);
    for (const who of ['asha', 'karthik']) {
      const read = await p(who).as.get(`/compliance/policies/${coc.id}/read`);
      await p(who).as.post(`/compliance/policies/${coc.id}/acknowledge`, { versionId: read.version.id });
    }
    const it = await hr.post('/compliance/policies', { title: 'Acceptable use of IT', category: 'IT_SECURITY', summary: 'Laptops, accounts and data', ackDueDays: 7, content: 'Lock your screen, use the password manager, never share credentials, and report lost devices within an hour.' });
    await hr.post(`/compliance/policies/${it.id}/publish`);
    await hr.post('/compliance/obligations/recommended');
  });

  await step('Acme: completed exit with settlement, letters and alumni profile', async () => {
    const g = p('gautam');
    const hr = p('hrManager').as;
    const exit = await g.as.post('/exits/resign', { reason: 'RELOCATION', reasonDetail: 'Moving to Germany with family' });
    const accepted = await p('engManager').as.post(`/exits/${exit.id}/approve`, { lastWorkingDay: today, note: 'Early release agreed; handover done' });
    await g.as.post(`/exits/${exit.id}/feedback`, { wouldRecommend: 9, wouldRejoin: true, liked: 'Great colleagues and real ownership', improve: 'Faster laptop refresh cycle' });
    for (const item of accepted.clearanceItems as { id: string }[]) await hr.patch(`/exits/${exit.id}/clearance/${item.id}`, { status: 'CLEARED', note: 'Done' });
    await p('payroll').as.post(`/exits/${exit.id}/settlement`, { adjustments: [{ label: 'Income tax (TDS)', kind: 'DEDUCTION', amount: 1800 }] });
    await p('payroll').as.post(`/exits/${exit.id}/settlement/submit`);
    await p('finance').as.post(`/exits/${exit.id}/settlement/approve`);
    await p('finance').as.post(`/exits/${exit.id}/settlement/pay`, { paidOn: today, reference: `UTR${today.replace(/-/g, '')}77` });
    await hr.post(`/exits/${exit.id}/complete`);
    for (const type of ['RELIEVING', 'EXPERIENCE']) await hr.post(`/exits/${exit.id}/letters`, await hr.get(`/exits/${exit.id}/letters/draft?type=${type}`));
    await g.as.put('/alumni/me', { optedIn: true, personalEmail: 'gautam.sinha@home.test', currentCompany: 'SAP', currentTitle: 'Developer', city: 'Berlin', openToOpportunities: true });
  });
  await step('Acme: shift rotation, roster and an attendance device', async () => {
    const a = o.admin.as;
    const morning = await a.post('/attendance/shifts', { name: 'Morning', startTime: '06:00', endTime: '14:00', weeklyOffs: [] });
    const evening = await a.post('/attendance/shifts', { name: 'Evening', startTime: '14:00', endTime: '22:00', weeklyOffs: [] });
    const rotation = await a.post('/attendance/rotations', { name: 'Operations 5-on 2-off', pattern: [{ shiftId: morning.id, days: 5 }, { shiftId: null, days: 2 }, { shiftId: evening.id, days: 5 }, { shiftId: null, days: 2 }] });
    await a.post('/attendance/roster/apply-rotation', { employeeIds: [p('manoj').employeeId], rotationId: rotation.id, from: mondayIn(0), to: addDays(mondayIn(0), 27) });
    await a.post('/attendance/devices', { name: 'Main entrance', serialNumber: 'ZK-F22-001', locationId: o.locations.get('Bengaluru HQ') });
    await a.put(`/attendance/employees/${p('manoj').employeeId}/biometric-code`, { biometricCode: '1019' });
  });
  await step('Acme: resignation on notice', async () => {
    const exit = await p('nikhil').as.post('/exits/resign', { reason: 'CAREER_GROWTH', reasonDetail: 'Moving to a product role at a start-up', requestedLastDay: addDays(today, 30) });
    await p('engManager').as.post(`/exits/${exit.id}/approve`, { lastWorkingDay: addDays(today, 30), note: 'Handover plan agreed with the team' });
  });
}

// ---- Brightleaf Retail (Growth: no benefits or grievances) --------------------------------------------------------

const BRIGHTLEAF: PersonSpec[] = [
  { key: 'admin', first: 'Rahul', last: 'Khanna', email: 'admin@brightleaf.test', roles: ['org_admin'], department: 'Head Office', designation: 'Director', location: 'Mumbai Store', gender: 'MALE', born: '1981-05-05', joined: '2020-04-01', ctc: 3_600_000 },
  { key: 'hr', first: 'Sunita', last: 'Pillai', email: 'hr@brightleaf.test', roles: ['hr_manager', 'payroll_manager'], department: 'Head Office', designation: 'HR Manager', location: 'Mumbai Store', manager: 'admin', gender: 'FEMALE', born: '1987-03-12', joined: '2021-01-11', ctc: 1_400_000 },
  { key: 'finance', first: 'Deepak', last: 'Shah', email: 'finance@brightleaf.test', roles: ['finance_manager'], department: 'Head Office', designation: 'Accountant', location: 'Mumbai Store', manager: 'admin', gender: 'MALE', born: '1985-09-19', joined: '2021-03-01', ctc: 1_100_000 },
  { key: 'manager', first: 'Fatima', last: 'Sheikh', email: 'store.manager@brightleaf.test', roles: ['department_manager'], department: 'Store Operations', designation: 'Store Manager', location: 'Mumbai Store', manager: 'admin', gender: 'FEMALE', born: '1989-12-22', joined: '2021-06-07', ctc: 900_000 },
  { key: 'emp1', first: 'Amit', last: 'Patil', email: 'employee@brightleaf.test', roles: ['employee'], department: 'Store Operations', designation: 'Sales Associate', location: 'Mumbai Store', manager: 'manager', gender: 'MALE', born: '1998-01-30', joined: '2023-04-03', ctc: 360_000 },
  { key: 'emp2', first: 'Kiran', last: 'More', email: 'kiran@brightleaf.test', roles: ['employee'], department: 'Store Operations', designation: 'Sales Associate', location: 'Mumbai Store', manager: 'manager', gender: 'FEMALE', born: '1999-08-08', joined: '2024-02-12', ctc: 340_000 },
  { key: 'emp3', first: 'Suresh', last: 'Naik', email: 'suresh@brightleaf.test', roles: ['employee'], department: 'Merchandising', designation: 'Visual Merchandiser', location: 'Mumbai Store', manager: 'manager', gender: 'MALE', born: '1994-04-14', joined: '2022-09-05', ctc: 480_000 },
];

async function seedBrightleaf(deps: Deps): Promise<void> {
  const o = await buildOrganization(
    deps,
    { name: 'Brightleaf Retail', plan: 'growth', industry: 'Retail', size: '51-200', email: 'hr@brightleaf.test' },
    { departments: ['Head Office', 'Store Operations', 'Merchandising'], designations: ['Sales Associate', 'Visual Merchandiser', 'Store Manager', 'Accountant', 'HR Manager', 'Director'], locations: [{ name: 'Mumbai Store', city: 'Mumbai', state: 'Maharashtra' }] },
    BRIGHTLEAF,
  );
  if (!o) return;
  const { p } = o;
  await step('Brightleaf: holidays and shift', () => seedCalendar(o));
  await step('Brightleaf: attendance', () => seedAttendance(o, {}));
  await step('Brightleaf: leave', () =>
    seedLeave(o, [
      { who: 'emp1', type: 'CL', start: mondayIn(1), end: mondayIn(1), reason: 'Sister’s graduation' },
      { who: 'emp2', type: 'SL', start: recentWorkdays(3)[0]!, end: recentWorkdays(3)[0]!, reason: 'Migraine', approve: true },
    ]),
  );
  await step('Brightleaf: salaries and last month’s payroll', async () => {
    await seedSalaries(o, p('hr'));
    await seedPayrollRun(o, p('hr'), p('finance'), { pay: false });
  });
  await step('Brightleaf: an open job', async () => {
    const req = await p('manager').as.post('/recruitment/requisitions', { title: 'Store Associate', designationId: o.designations.get('Sales Associate'), reason: 'NEW_ROLE', justification: 'Weekend footfall has doubled since the mall extension opened', openings: 2, submit: true });
    await p('hr').as.post(`/recruitment/requisitions/${req.id}/approve`);
    const job = await p('hr').as.post('/recruitment/jobs', { requisitionId: req.id, description: 'Help customers find the right products, keep the floor tidy and run the billing counter on busy days.', isPublic: true });
    await p('hr').as.post(`/recruitment/jobs/${job.id}/status`, { status: 'OPEN' });
    await p('hr').as.post('/recruitment/candidates', { firstName: 'Neeta', lastName: 'Kulkarni', email: 'neeta.kulkarni@candidates.test', jobId: job.id, source: 'DIRECT', experienceYears: 1 });
  });
  await step('Brightleaf: announcement', async () => {
    const a = await p('hr').as.post('/engagement/announcements', { title: 'Festive season rota', body: 'The festive rota for the next four weekends is pinned in the staff room. Swaps need the store manager’s OK.', category: 'GENERAL', pinned: true });
    await p('hr').as.post(`/engagement/announcements/${a.id}/publish`);
  });
}

// ---- Nimbus Labs (Starter: core HR) -------------------------------------------------------------------------------

const NIMBUS: PersonSpec[] = [
  { key: 'admin', first: 'Tara', last: 'Bose', email: 'admin@nimbus.test', roles: ['org_admin'], department: 'Product', designation: 'Founder', location: 'Kolkata Studio', gender: 'FEMALE', born: '1990-10-10', joined: '2024-01-01', ctc: 2_400_000 },
  { key: 'lead', first: 'Dev', last: 'Sen', email: 'team.lead@nimbus.test', roles: ['team_lead'], department: 'Product', designation: 'Lead Designer', location: 'Kolkata Studio', manager: 'admin', gender: 'MALE', born: '1993-06-06', joined: '2024-02-05', ctc: 1_600_000 },
  { key: 'emp1', first: 'Riya', last: 'Ghosh', email: 'employee@nimbus.test', roles: ['employee'], department: 'Product', designation: 'Product Designer', location: 'Kolkata Studio', manager: 'lead', gender: 'FEMALE', born: '1998-02-20', joined: '2024-06-03', ctc: 900_000 },
  { key: 'emp2', first: 'Arnab', last: 'Dutta', email: 'arnab@nimbus.test', roles: ['employee'], department: 'Product', designation: 'Frontend Developer', location: 'Kolkata Studio', manager: 'lead', gender: 'MALE', born: '1997-11-11', joined: '2025-01-13', ctc: 1_000_000 },
];

async function seedNimbus(deps: Deps): Promise<void> {
  const o = await buildOrganization(
    deps,
    { name: 'Nimbus Labs', plan: 'starter', industry: 'Design studio', size: '1-10', email: 'hello@nimbus.test' },
    { departments: ['Product'], designations: ['Product Designer', 'Frontend Developer', 'Lead Designer', 'Founder'], locations: [{ name: 'Kolkata Studio', city: 'Kolkata', state: 'West Bengal' }] },
    NIMBUS,
  );
  if (!o) return;
  const { p } = o;
  await step('Nimbus: holidays and shift', () => seedCalendar(o));
  await step('Nimbus: attendance', () => seedAttendance(o, {}));
  await step('Nimbus: leave', () => seedLeave(o, [{ who: 'emp1', type: 'CL', start: mondayIn(1), end: addDays(mondayIn(1), 1), reason: 'Durga Puja travel' }, { who: 'emp2', type: 'SL', start: recentWorkdays(2)[0]!, end: recentWorkdays(2)[0]!, reason: 'Cold', approve: true }]));
  await step('Nimbus: announcement', async () => {
    const a = await p('admin').as.post('/engagement/announcements', { title: 'Studio offsite', body: 'We are heading to Shantiniketan for a two-day offsite next month. Details soon!', category: 'EVENT', eventStartsAt: iso(new Date(`${addDays(nextMonth, 9)}T04:30:00Z`)), eventLocation: 'Shantiniketan' });
    await p('admin').as.post(`/engagement/announcements/${a.id}/publish`);
  });
}

// ---- Main -------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  // The seed signs in dozens of users from one address; rate limits stay in force for the real server.
  ThrottlerGuard.prototype.canActivate = async () => true;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  // Nothing leaves the machine: demo addresses aren't real.
  app.get(MailService).send = async () => undefined;
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;

  try {
    await seedPlans();
    const deps: Deps = { db: app.get(DatabaseService), hasher: app.get(PasswordHasher), provisioning: app.get(OrganizationProvisioningService) };
    await seedAcme(deps);
    await seedBrightleaf(deps);
    await seedNimbus(deps);
    // Scenario data for every screen state; it skips whatever already exists, so it also tops up an older Acme.
    const acmeId = await demoOrganizationId(deps.db, 'admin@acme.test');
    if (acmeId) await runDemoExtras(createKit(base, deps.db, acmeId, problems));
    console.log(`Done. Every demo user signs in with the password ${DEMO_PASSWORD} (see docs/DEMO.md).`);
    if (problems.length) {
      logger.warn(`${problems.length} part(s) could not be created:`);
      for (const p of problems) logger.warn(` - ${p}`);
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  logger.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
