/**
 * Toolkit for the demo "extras": scenario data on top of the Acme demo organization (overdue filings, payroll in
 * approval, resolved grievances…), so every state of every screen has something to show. Scenarios go through the
 * real API like the main demo seed; `sql` is only for moving dates into the past where no API can (e.g. a policy
 * published three weeks ago). Every scenario must be idempotent: check for its own data first and skip if present.
 */
import { Logger } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { addDays, zonedParts } from '../../common/utils/zoned-time';
import type { DatabaseService } from '../database.service';

export const DEMO_PASSWORD = 'Demo@Hrms2026';
export const DEMO_TZ = 'Asia/Kolkata';
export type Json = Record<string, any>;

/** An API client signed in as one demo user. */
export class As {
  constructor(
    private readonly base: string,
    readonly token: string,
  ) {}
  get = (path: string) => call(this.base, 'GET', path, this.token);
  post = (path: string, body: unknown = {}) => call(this.base, 'POST', path, this.token, body);
  put = (path: string, body: unknown) => call(this.base, 'PUT', path, this.token, body);
  patch = (path: string, body: unknown) => call(this.base, 'PATCH', path, this.token, body);
  delete = (path: string) => call(this.base, 'DELETE', path, this.token);
  upload = (path: string, fields: Record<string, string>, file: { data: Buffer; name: string; type: string }) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
    return call(this.base, 'POST', path, this.token, undefined, form);
  };
}

async function call(base: string, method: string, path: string, token: string | null, body?: unknown, form?: FormData): Promise<any> {
  const headers: Record<string, string> = { 'user-agent': 'hrms-demo-extras' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as Json).data : null;
}

/** A one-page PDF that file-type checks accept (receipts, documents). */
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/**
 * The demo organization a demo admin belongs to. Found by membership rather than by name, so an organization whose
 * display name was changed in Settings is still recognised.
 */
export async function demoOrganizationId(db: DatabaseService, adminEmail: string): Promise<string | null> {
  const [row] = await db.select<{ id: string }>(
    `SELECT m.organization_id AS id FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = lower(:email) ORDER BY m.created_at LIMIT 1`,
    { email: adminEmail },
  );
  return row?.id ?? null;
}

export interface Kit {
  /** API base, e.g. http://127.0.0.1:12345/api/v1. */
  base: string;
  db: DatabaseService;
  orgId: string;
  /** Today in the organization's time zone (YYYY-MM-DD). */
  today: string;
  /** `today` shifted by n days. */
  day: (n: number) => string;
  /** Signs in a demo user (cached per email). */
  as: (email: string) => Promise<As>;
  /** The demo employee with this work email: employee id, user id, name. */
  person: (email: string) => Promise<{ employeeId: string; userId: string | null; name: string; designationId: string | null; departmentId: string | null }>;
  /** Raw SQL (named replacements) — for backdating only. */
  sql: <T extends object = Json>(query: string, replacements?: Record<string, unknown>) => Promise<T[]>;
  /** Runs one scenario; failures are collected and reported at the end instead of stopping the rest. */
  step: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  /** Prints a line under the current area. */
  log: (message: string) => void;
}

export function createKit(base: string, db: DatabaseService, orgId: string, problems: string[]): Kit {
  const logger = new Logger('DemoExtras');
  const tokens = new Map<string, As>();
  const today = zonedParts(new Date(), DEMO_TZ).date;
  const sql = async <T extends object = Json>(query: string, replacements: Record<string, unknown> = {}): Promise<T[]> => {
    const options = { replacements: { orgId, ...replacements } };
    if (/^\s*(select|with)\b/i.test(query)) return db.sequelize.query<T>(query, { ...options, type: QueryTypes.SELECT });
    const [rows] = await db.sequelize.query(query, options);
    return rows as T[];
  };
  return {
    base,
    db,
    orgId,
    today,
    day: (n) => addDays(today, n),
    as: async (email) => {
      const cached = tokens.get(email);
      if (cached) return cached;
      const data = await call(base, 'POST', '/auth/login', null, { email, password: DEMO_PASSWORD });
      if (data.status !== 'AUTHENTICATED') throw new Error(`Login for ${email} needs ${data.status}`);
      const as = new As(base, data.accessToken);
      tokens.set(email, as);
      return as;
    },
    person: async (email) => {
      const [row] = await sql<{ employeeId: string; userId: string | null; name: string; designationId: string | null; departmentId: string | null }>(
        `SELECT e.id AS "employeeId", u.id AS "userId", e.first_name || ' ' || e.last_name AS name, e.designation_id AS "designationId", e.department_id AS "departmentId"
           FROM employees e LEFT JOIN organization_memberships m ON m.id = e.membership_id LEFT JOIN users u ON u.id = m.user_id
          WHERE e.organization_id = :orgId AND lower(e.work_email) = lower(:email)`,
        { email },
      );
      if (!row) throw new Error(`No demo employee with email ${email}`);
      return row;
    },
    sql,
    step: async (label, fn) => {
      try {
        const result = await fn();
        console.log(`  ✓ ${label}${result === 'skipped' ? ' (already there)' : ''}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        problems.push(`${label}: ${message}`);
        logger.warn(`✗ ${label}: ${message}`);
      }
    },
    log: (message) => console.log(`    ${message}`),
  };
}
