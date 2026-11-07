import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { authenticator } from 'otplib';
import { Op, QueryTypes } from 'sequelize';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { addDays, zonedParts } from '../src/common/utils/zoned-time';
import { DatabaseService } from '../src/database/database.service';
import { MembershipRole, OrganizationMembership, Plan, Role } from '../src/database/models';
import { PasswordHasher } from '../src/infrastructure/crypto/password-hasher.service';
import { MailService } from '../src/infrastructure/mail/mail.service';
import { createUserWithPassword, seedPlans } from '../src/infrastructure/seed/platform-bootstrap';
import { OrganizationProvisioningService } from '../src/modules/organizations/organization-provisioning.service';

export const PASSWORD = 'Correct-Horse-Battery-9';
export const API = '/api/v1';

/** Test fixtures and assertions read/write across tenants directly. */
export const RAW = { skipTenantScope: true } as const;

/** Test organizations use the default time zone; "today" must be theirs, which can be a day ahead of UTC. */
export const ORG_TIMEZONE = 'Asia/Kolkata';
export const orgToday = () => zonedParts(new Date(), ORG_TIMEZONE).date;
export const orgDays = (n: number) => addDays(orgToday(), n);

export interface TestContext {
  app: INestApplication;
  db: DatabaseService;
  mail: MailService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return {
    app,
    db: app.get(DatabaseService),
    mail: app.get(MailService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/** Wipes all tenant/identity data but keeps the synced permission & feature catalog; re-creates plans. */
export async function resetDatabase(ctx: TestContext): Promise<void> {
  const tables = await ctx.db.sequelize.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND tablename NOT IN ('schema_migrations', 'permissions', 'features')`,
    { type: QueryTypes.SELECT },
  );
  await ctx.db.sequelize.query(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await seedPlans();
  ctx.mail.outbox.length = 0;
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}${counter}@example.test`;
}

export async function createUser(ctx: TestContext, opts: { email?: string; password?: string; firstName?: string; lastName?: string; platformRole?: 'SUPER_ADMIN' } = {}) {
  return createUserWithPassword(ctx.app.get(PasswordHasher), {
    email: opts.email ?? uniqueEmail(),
    firstName: opts.firstName ?? 'Riya',
    lastName: opts.lastName ?? 'Sharma',
    password: opts.password ?? PASSWORD,
    platformRole: opts.platformRole ?? null,
  });
}

export async function createOrganization(ctx: TestContext, opts: { name?: string; planCode?: string } = {}) {
  const plan = await Plan.findOne({ where: { code: opts.planCode ?? 'enterprise' }, rejectOnEmpty: true });
  return ctx.db.transaction((transaction) =>
    ctx.app.get(OrganizationProvisioningService).provision(transaction, { name: opts.name ?? `Org ${uniqueEmail('o')}`, planId: plan.id, status: 'ACTIVE' }),
  );
}

/** Adds an existing user to an organization with the given system/custom role keys. */
export async function addMember(ctx: TestContext, organizationId: string, userId: string, roleKeys: string[], status: 'ACTIVE' | 'INVITED' = 'ACTIVE') {
  const roles = await Role.findAll({ where: { organizationId, key: { [Op.in]: roleKeys } }, ...RAW });
  const membership = await OrganizationMembership.create(
    { organizationId, userId, status, joinedAt: status === 'ACTIVE' ? new Date() : null },
    RAW,
  );
  if (roles.length) {
    await MembershipRole.bulkCreate(roles.map((r) => ({ organizationId, membershipId: membership.id, roleId: r.id })), RAW);
  }
  return membership;
}

/** Creates an organization plus an Organization Admin user. */
export async function createOrgWithAdmin(ctx: TestContext, opts: { planCode?: string; name?: string } = {}) {
  const { organization, roleIdsByKey } = await createOrganization(ctx, opts);
  const admin = await createUser(ctx, { email: uniqueEmail('admin'), firstName: 'Olivia', lastName: 'Owner' });
  const membership = await addMember(ctx, organization.id, admin.id, ['org_admin']);
  return { organization, roleIdsByKey, admin, membership };
}

export interface LoggedIn {
  accessToken: string;
  cookie: string;
  body: any;
}

export function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('hrms_rt='));
  if (!cookie) throw new Error('No refresh cookie in response');
  return cookie.split(';')[0];
}

export async function login(ctx: TestContext, email: string, password = PASSWORD, organizationId?: string): Promise<LoggedIn> {
  const res = await ctx.http().post(`${API}/auth/login`).send({ email, password, organizationId });
  if (res.status !== 200 || res.body.data.status !== 'AUTHENTICATED') {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { accessToken: res.body.data.accessToken, cookie: refreshCookieFrom(res), body: res.body };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** TOTP code for the current step plus `offsetSteps` (codes within the ±1 window are accepted). */
export function totp(secret: string, offsetSteps = 0): string {
  const gen = authenticator.clone({ epoch: Date.now() + offsetSteps * 30_000 });
  return gen.generate(secret);
}

/** Extracts the token query parameter from the last email sent to `to`. */
export function tokenFromMail(ctx: TestContext, to: string): string {
  const message = [...ctx.mail.outbox].reverse().find((m) => m.to === to);
  if (!message) throw new Error(`No email sent to ${to}`);
  const match = message.text.match(/token=([^\s]+)/);
  if (!match) throw new Error('No token in email');
  return decodeURIComponent(match[1]);
}
