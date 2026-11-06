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
