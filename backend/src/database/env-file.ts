import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loads `.env` (or `.env.test` when NODE_ENV=test) from the backend folder for CLI scripts.
 * Variables already present in the environment take precedence.
 */
export function loadEnvFile(): void {
  const file = join(__dirname, '..', '..', process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
  if (existsSync(file)) config({ path: file, quiet: true });
}

/** Demo data (shared demo passwords, fake people) must never land in a production database by accident. */
export function refuseDemoDataInProduction(script: string): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_DATA !== 'true') {
    throw new Error(`${script} creates demo organizations with a shared password and is refused when NODE_ENV=production. Set ALLOW_DEMO_DATA=true only for a throwaway demo environment.`);
  }
}
