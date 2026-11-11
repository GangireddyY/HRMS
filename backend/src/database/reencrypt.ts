/**
 * Re-encrypt CLI (`npm run db:reencrypt`, production: `node dist/database/reencrypt.js`).
 * Rewrites every encrypted column (ENCRYPTED_FIELDS) that isn't yet in the current format and key version: values from
 * the earlier context-free format, values under a previous key (after a rotation), and contact details still stored as
 * plain text. Idempotent and safe to run while the API is up (each row is updated only if it hasn't changed meanwhile).
 * `--dry-run` only counts.
 */
import type { Sequelize } from 'sequelize-typescript';
import { ENCRYPTED_FIELDS, type EncryptedField } from '../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../infrastructure/crypto/encryption.service';
import { resolveDataKeys } from '../infrastructure/crypto/key-source';
import { loadEnvFile } from './env-file';
import { createSequelize, databaseConnectionFromEnv } from './sequelize';

const BATCH = 500;

export interface ReencryptResult {
  field: string;
  rewritten: number;
  failed: number;
}

export async function reencryptAll(sequelize: Sequelize, crypto: EncryptionService, opts: { dryRun?: boolean; log?: (line: string) => void } = {}): Promise<ReencryptResult[]> {
  const results: ReencryptResult[] = [];
  for (const field of ENCRYPTED_FIELDS) results.push(await reencryptField(sequelize, crypto, field, opts));
  return results;
}

async function reencryptField(sequelize: Sequelize, crypto: EncryptionService, f: EncryptedField, opts: { dryRun?: boolean; log?: (line: string) => void }): Promise<ReencryptResult> {
  const result = { field: `${f.table}.${f.column}`, rewritten: 0, failed: 0 };
  const current = `k${crypto.currentVersion}:%`;
  const pk = f.rowId ?? 'id';
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const [rows] = (await sequelize.query(
      `SELECT "${pk}" AS "id", "${f.key}" AS "key", "${f.column}" AS "value" FROM "${f.table}"
        WHERE "${f.column}" IS NOT NULL AND "${f.column}" NOT LIKE :current AND "${pk}" > :after
        ORDER BY "${pk}" LIMIT ${BATCH}`,
      { replacements: { current, after } },
    )) as [{ id: string; key: string; value: string }[], unknown];
    if (!rows.length) break;
    for (const row of rows) {
      after = row.id;
      const context = f.context(row.key);
      let plain: string;
      try {
        if (crypto.isCiphertext(row.value)) plain = crypto.decrypt(row.value, context);
        else if (f.plainLegacy) plain = row.value;
        else throw new Error('not ciphertext');
      } catch (e) {
        result.failed++;
        opts.log?.(`  ${result.field} ${row.id}: can't read (${(e as Error).message}); left unchanged`);
        continue;
      }
      if (!opts.dryRun) {
        await sequelize.query(`UPDATE "${f.table}" SET "${f.column}" = :next WHERE "${pk}" = :id AND "${f.column}" = :old`, {
          replacements: { next: crypto.encrypt(plain, context), id: row.id, old: row.value },
        });
      }
      result.rewritten++;
    }
  }
  return result;
}

async function main(): Promise<void> {
  loadEnvFile();
  const env = process.env;
  if (!env.DATA_ENCRYPTION_KEY) throw new Error('DATA_ENCRYPTION_KEY is required');
  const keys = await resolveDataKeys({ source: env.DATA_ENCRYPTION_KEY_SOURCE === 'aws-kms' ? 'aws-kms' : 'env', key: env.DATA_ENCRYPTION_KEY, previous: env.DATA_ENCRYPTION_PREVIOUS_KEYS, kmsRegion: env.KMS_REGION });
  const crypto = new EncryptionService(keys.key, Number(env.DATA_ENCRYPTION_KEY_VERSION || 1), keys.previous);
  const dryRun = process.argv.includes('--dry-run');
  const sequelize = createSequelize(databaseConnectionFromEnv(), { withModels: false });
  try {
    const results = await reencryptAll(sequelize, crypto, { dryRun, log: console.warn });
    const touched = results.filter((r) => r.rewritten || r.failed);
    for (const r of touched) console.log(`${r.field}: ${r.rewritten} ${dryRun ? 'to rewrite' : 'rewritten'}${r.failed ? `, ${r.failed} unreadable` : ''}`);
    if (!touched.length) console.log(`All encrypted values are current (key version ${crypto.currentVersion})`);
    if (results.some((r) => r.failed)) process.exitCode = 2;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
