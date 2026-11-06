import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadApiTestEnv } from './env';

/** Applies migrations and runs the idempotent seed (plans, Super Admin) on the test DB. */
export default function globalSetup(): void {
  const env: Record<string, string | undefined> = { ...process.env, ...loadApiTestEnv(), NODE_ENV: 'test' };
  const dbName = env.DB_NAME ?? '';
  if (!/test/i.test(dbName)) throw new Error(`Refusing to seed non-test database "${dbName}"`);
  const cwd = fileURLToPath(new URL('../../backend', import.meta.url));
  execSync('npm run db:migrate', { cwd, env, stdio: 'inherit' });
  execSync('npm run db:seed', { cwd, env, stdio: 'inherit' });
}
