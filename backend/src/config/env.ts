import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength, validateSync } from 'class-validator';
import { parseKeyRing } from '../infrastructure/crypto/encryption.service';
import { parseDsn } from '../infrastructure/observability/dsn';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';
const toBoolDefaultTrue = ({ value }: { value: unknown }) => (value === undefined || value === '' ? true : toBool({ value }));
const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Transform(toInt) @IsInt() @Min(1) @Max(65535)
  PORT = 3000;

  @IsString()
  CORS_ORIGINS = 'http://localhost:5173';

  @IsUrl({ require_tld: false })
  APP_URL = 'http://localhost:5173';

  @Transform(toInt) @IsInt() @Min(0)
  TRUST_PROXY = 0;

  @IsString() @MinLength(1)
  DB_HOST = 'localhost';

  @Transform(toInt) @IsInt() @Min(1) @Max(65535)
  DB_PORT = 5432;

  @IsString() @MinLength(1)
  DB_NAME!: string;

  @IsString() @MinLength(1)
  DB_USER!: string;

  @IsString() @MinLength(1)
  DB_PASSWORD!: string;

  /** Require TLS with certificate verification (managed databases). */
  @Transform(toBool) @IsBoolean()
  DB_SSL = false;

  /** Production normally requires DB_SSL; true only for a database on a private network (e.g. the Docker stack). */
  @Transform(toBool) @IsBoolean()
  DB_ALLOW_INSECURE = false;

  /** Schema owner used by migrations only (`npm run db:migrate`); the API connects as DB_USER. */
  @IsOptional() @IsString()
  DB_MIGRATION_USER?: string;

  @IsOptional() @IsString()
  DB_MIGRATION_PASSWORD?: string;

  @IsOptional() @IsString()
  REDIS_URL?: string;

  @IsString() @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @Transform(toInt) @IsInt() @Min(60) @Max(3600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @Transform(toInt) @IsInt() @Min(1) @Max(90)
  REFRESH_TOKEN_TTL_DAYS = 7;

  @IsString()
  DATA_ENCRYPTION_KEY!: string;

  /** Version written into new ciphertext; bump it when DATA_ENCRYPTION_KEY changes. */
  @Transform(toInt) @IsInt() @Min(1) @Max(9999)
  DATA_ENCRYPTION_KEY_VERSION = 1;

  /** Earlier keys still needed to read older values, e.g. `1:<base64>`; drop them after `npm run db:reencrypt`. */
  @IsOptional() @IsString()
  DATA_ENCRYPTION_PREVIOUS_KEYS?: string;

  @Transform(toBool) @IsBoolean()
  COOKIE_SECURE = false;

  @IsString()
  MFA_ISSUER = 'HRMS';

  /** Platform staff (Super Admins) must use two-factor sign-in. Can only be switched off outside production (test automation). */
  @Transform(toBoolDefaultTrue) @IsBoolean()
  PLATFORM_MFA_REQUIRED = true;

  @Transform(toBool) @IsBoolean()
  ALLOW_ORGANIZATION_SIGNUP = false;

  @IsString()
  DEFAULT_PLAN_CODE = 'starter';

  /** SendGrid API key. Required in production; when empty in development, emails are written to the API log. */
  @IsOptional() @IsString()
  SENDGRID_API_KEY?: string;

  /** SendGrid validates the request but delivers nothing (staging / load tests). */
  @Transform(toBool) @IsBoolean()
  SENDGRID_SANDBOX_MODE = false;

  /** Sender address; must be a verified Sender Identity or on an authenticated domain in SendGrid. */
  @IsEmail({ require_tld: false })
  SENDGRID_FROM_EMAIL = 'no-reply@hrms.local';

  @IsString() @MinLength(1)
  SENDGRID_FROM_NAME = 'HRMS';

  /** Where uploaded files (employee documents) are kept: local disk for development, S3 (or compatible) in production. */
  @IsIn(['local', 's3'])
  STORAGE_DRIVER: 'local' | 's3' = 'local';

  /** Directory for the local driver, relative to the backend folder unless absolute. */
  @IsString() @MinLength(1)
  STORAGE_LOCAL_DIR = 'uploads';

  @IsOptional() @IsString()
  S3_BUCKET?: string;

  @IsOptional() @IsString()
  S3_REGION?: string;

  /** Custom endpoint for S3-compatible stores (MinIO, R2); leave empty for AWS. Credentials come from the standard AWS chain. */
  @Transform(emptyToUndefined) @IsOptional() @IsUrl({ require_tld: false })
  S3_ENDPOINT?: string;

  @Transform(toBool) @IsBoolean()
  S3_FORCE_PATH_STYLE = false;

  /** Malware scanning of uploads before they are stored: clamav (required in production) or off (test signature only). */
  @IsIn(['off', 'clamav'])
  UPLOAD_SCAN: 'off' | 'clamav' = 'off';

  @IsString() @MinLength(1)
  CLAMAV_HOST = 'localhost';

  @Transform(toInt) @IsInt() @Min(1) @Max(65535)
  CLAMAV_PORT = 3310;

  @Transform(toInt) @IsInt() @Min(1000) @Max(120_000)
  CLAMAV_TIMEOUT_MS = 30_000;

  /** Error reporting to Sentry (or a compatible service); unset = off. */
  @IsOptional() @IsString()
  SENTRY_DSN?: string;

  /** json: one JSON object per line (default in production); text: Nest's readable format. */
  @IsOptional() @IsIn(['json', 'text'])
  LOG_FORMAT?: 'json' | 'text';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, { exposeDefaultValues: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
    throw new Error(`Invalid environment configuration:\n  ${details.join('\n  ')}`);
  }
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  parseDsn(env.SENTRY_DSN);
  const previous = parseKeyRing(env.DATA_ENCRYPTION_PREVIOUS_KEYS);
  for (const [version, k] of previous) {
    if (Buffer.from(k, 'base64').length !== 32) throw new Error(`DATA_ENCRYPTION_PREVIOUS_KEYS: key ${version} must be 32 bytes encoded as base64`);
    if (version === env.DATA_ENCRYPTION_KEY_VERSION) throw new Error(`DATA_ENCRYPTION_PREVIOUS_KEYS must not reuse the current version ${version}`);
  }
  if (env.SENDGRID_API_KEY && !env.SENDGRID_API_KEY.startsWith('SG.')) {
    throw new Error('SENDGRID_API_KEY must be a SendGrid API key (starts with "SG.")');
  }
  if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) throw new Error('S3_BUCKET and S3_REGION are required when STORAGE_DRIVER is s3');
  if (env.NODE_ENV === 'production') {
    if (env.STORAGE_DRIVER !== 's3') throw new Error('STORAGE_DRIVER must be s3 in production (local disk is not shared between instances)');
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (!env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY is required in production');
    if (env.SENDGRID_SANDBOX_MODE) throw new Error('SENDGRID_SANDBOX_MODE must be false in production');
    if (env.DB_USER === 'postgres') throw new Error('DB_USER must be a least-privilege role in production, not the postgres superuser');
    if (!env.PLATFORM_MFA_REQUIRED) throw new Error('PLATFORM_MFA_REQUIRED must be true in production');
    if (!env.DB_SSL && !env.DB_ALLOW_INSECURE) {
      throw new Error('DB_SSL must be true in production (set DB_ALLOW_INSECURE=true only when the database is on a private network, e.g. the Docker stack)');
    }
    if (!env.REDIS_URL) throw new Error('REDIS_URL is required in production (rate limits are shared between API instances)');
    if (env.UPLOAD_SCAN !== 'clamav') throw new Error('UPLOAD_SCAN must be clamav in production (uploads are scanned for malware before they are stored)');
    if (env.DB_MIGRATION_USER && env.DB_MIGRATION_USER === env.DB_USER) {
      throw new Error('DB_USER (the API) must differ from DB_MIGRATION_USER (the schema owner) in production');
    }
  }
  return env;
}
