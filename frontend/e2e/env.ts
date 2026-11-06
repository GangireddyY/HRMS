import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Reads backend/.env.test (the e2e stack runs the API in test mode against the test database). */
export function loadApiTestEnv(): Record<string, string> {
  const file = fileURLToPath(new URL('../../backend/.env.test', import.meta.url));
  const out: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
    }
  }
  const passthrough = (k: string) => k in out || k.startsWith('SUPERADMIN_') || k.startsWith('E2E_');
  return { ...out, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => passthrough(k)) as [string, string][]) };
}

/** Organization the e2e setup signs up; its owner becomes the Organization Admin. */
export const E2E_ORGANIZATION = 'Acme Technologies';

/**
 * Super Admin: seeded by `npm run db:seed`.
 * Organization Admin: not seeded – created by org-admin.setup.ts through organization sign-up.
 */
export function credentials() {
  const env = loadApiTestEnv();
  const need = ['SUPERADMIN_EMAIL', 'SUPERADMIN_PASSWORD', 'E2E_ORG_ADMIN_EMAIL', 'E2E_ORG_ADMIN_PASSWORD'];
  for (const k of need) if (!env[k]) throw new Error(`${k} must be set in backend/.env.test for e2e tests`);
  return {
    superAdmin: { email: env.SUPERADMIN_EMAIL!, password: env.SUPERADMIN_PASSWORD! },
    orgAdmin: { email: env.E2E_ORG_ADMIN_EMAIL!, password: env.E2E_ORG_ADMIN_PASSWORD! },
  };
}
