import { databaseConnectionFromEnv } from '../database/sequelize';
import { validateEnv } from './env';

const production = {
  NODE_ENV: 'production',
  APP_URL: 'https://hr.example.com',
  CORS_ORIGINS: 'https://hr.example.com',
  DB_NAME: 'hrms',
  DB_USER: 'hrms_app',
  DB_PASSWORD: 'secret',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  COOKIE_SECURE: 'true',
  SENDGRID_API_KEY: 'SG.key',
  SENDGRID_FROM_EMAIL: 'no-reply@example.com',
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'hrms',
  S3_REGION: 'ap-south-1',
  DB_SSL: 'true',
  UPLOAD_SCAN: 'clamav',
};

describe('validateEnv (production)', () => {
  it('accepts a hardened configuration', () => {
    expect(() => validateEnv(production)).not.toThrow();
  });

  it('requires TLS to the database unless the network is declared private', () => {
    expect(() => validateEnv({ ...production, DB_SSL: 'false' })).toThrow(/DB_SSL must be true/);
    expect(() => validateEnv({ ...production, DB_SSL: 'false', DB_ALLOW_INSECURE: 'true' })).not.toThrow();
  });

  it('requires malware scanning of uploads', () => {
    expect(() => validateEnv({ ...production, UPLOAD_SCAN: 'off' })).toThrow(/UPLOAD_SCAN must be clamav/);
  });

  it('refuses running the API as the schema owner', () => {
    expect(() => validateEnv({ ...production, DB_MIGRATION_USER: 'hrms_app' })).toThrow(/must differ/);
    expect(() => validateEnv({ ...production, DB_MIGRATION_USER: 'hrms_owner' })).not.toThrow();
  });
});

describe('databaseConnectionFromEnv', () => {
  const env = { DB_NAME: 'hrms', DB_USER: 'hrms_app', DB_PASSWORD: 'app', DB_MIGRATION_USER: 'hrms_owner', DB_MIGRATION_PASSWORD: 'owner' };

  it('uses the runtime role by default and the schema owner for migrations', () => {
    expect(databaseConnectionFromEnv(env)).toMatchObject({ user: 'hrms_app', password: 'app' });
    expect(databaseConnectionFromEnv(env, { migration: true })).toMatchObject({ user: 'hrms_owner', password: 'owner' });
  });

  it('falls back to DB_USER for migrations when no owner is configured', () => {
    expect(databaseConnectionFromEnv({ ...env, DB_MIGRATION_USER: '' }, { migration: true })).toMatchObject({ user: 'hrms_app' });
  });
});
