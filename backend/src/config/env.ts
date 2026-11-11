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

  /**
   * env: the keys above are the base64 keys. aws-kms (envelope encryption): they are KMS-encrypted data keys
   * (`aws kms generate-data-key --key-spec AES_256 --encryption-context app=hrms,purpose=data-encryption-key`),
   * decrypted at startup with the API's IAM role.
   */
  @IsIn(['env', 'aws-kms'])
  DATA_ENCRYPTION_KEY_SOURCE: 'env' | 'aws-kms' = 'env';

  /** Region of the KMS key (defaults to the AWS SDK's region resolution). */
  @IsOptional() @IsString()
  KMS_REGION?: string;

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

  /** New passwords are checked against breached passwords (Have I Been Pwned, k-anonymity). Off in tests. */
  @Transform(toBoolDefaultTrue) @IsBoolean()
  PASSWORD_BREACH_CHECK = true;

  /** Development without SendGrid: also write the links in logged emails (they carry one-time tokens). */
  @Transform(toBool) @IsBoolean()
  MAIL_LOG_LINKS = false;

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

  /**
   * Audit and login-history archives are written once and can't be deleted or overwritten for this many days
   * (S3 Object Lock; the bucket must have Object Lock enabled). 0 = no retention lock (not allowed in production).
   */
  @Transform(toInt) @IsInt() @Min(0) @Max(36_500)
  AUDIT_ARCHIVE_RETENTION_DAYS = 2557;

  /** COMPLIANCE: nobody can shorten the lock, not even the bucket owner. GOVERNANCE: principals with bypass permission can. */
  @IsIn(['COMPLIANCE', 'GOVERNANCE'])
  AUDIT_ARCHIVE_LOCK_MODE: 'COMPLIANCE' | 'GOVERNANCE' = 'COMPLIANCE';

  /** Malware scanning of uploads before they are stored: clamav (required in production) or off (test signature only). */
  @IsIn(['off', 'clamav'])
  UPLOAD_SCAN: 'off' | 'clamav' = 'off';

  @IsString() @MinLength(1)
  CLAMAV_HOST = 'localhost';

  @Transform(toInt) @IsInt() @Min(1) @Max(65535)
  CLAMAV_PORT = 3310;

  @Transform(toInt) @IsInt() @Min(1000) @Max(120_000)
  CLAMAV_TIMEOUT_MS = 30_000;

  /** Web Push (VAPID) keys: `npx web-push generate-vapid-keys`. Unset = browser notifications off. */
  @Transform(emptyToUndefined) @IsOptional() @IsString()
  VAPID_PUBLIC_KEY?: string;

  @Transform(emptyToUndefined) @IsOptional() @IsString()
  VAPID_PRIVATE_KEY?: string;

  /** Contact for push services, `mailto:` or https URL. */
  @IsString()
  VAPID_SUBJECT = 'mailto:no-reply@hrms.local';

  /**
   * WhatsApp notifications: meta (WhatsApp Business Cloud API), log (written to the server log; development) or off.
   * Business-initiated messages use approved templates: WHATSAPP_TEMPLATE takes {{1}} = title, {{2}} = link;
   * WHATSAPP_CODE_TEMPLATE (an authentication template) takes {{1}} = the verification code.
   */
  @IsIn(['off', 'log', 'meta'])
  WHATSAPP_PROVIDER: 'off' | 'log' | 'meta' = 'off';

  @Transform(emptyToUndefined) @IsOptional() @IsString()
  WHATSAPP_TOKEN?: string;

  @Transform(emptyToUndefined) @IsOptional() @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  @IsString() @MinLength(1)
  WHATSAPP_TEMPLATE = 'hrms_notification';

  @IsString() @MinLength(1)
  WHATSAPP_CODE_TEMPLATE = 'hrms_verification_code';

  @IsString() @MinLength(2)
  WHATSAPP_TEMPLATE_LANGUAGE = 'en';

  @IsString()
  WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

  /** Bearer token Prometheus scrapes `GET /api/v1/metrics` with (at least 24 characters); unset = endpoint off. Required in production. */
  @Transform(emptyToUndefined) @IsOptional() @IsString() @MinLength(24)
  METRICS_TOKEN?: string;

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
  const plainKeys = env.DATA_ENCRYPTION_KEY_SOURCE === 'env';
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  if (plainKeys && key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  if (!plainKeys && key.length < 64) throw new Error('DATA_ENCRYPTION_KEY must be the base64 CiphertextBlob of a KMS data key when DATA_ENCRYPTION_KEY_SOURCE is aws-kms');
  parseDsn(env.SENTRY_DSN);
  const previous = parseKeyRing(env.DATA_ENCRYPTION_PREVIOUS_KEYS);
  for (const [version, k] of previous) {
    if (plainKeys && Buffer.from(k, 'base64').length !== 32) throw new Error(`DATA_ENCRYPTION_PREVIOUS_KEYS: key ${version} must be 32 bytes encoded as base64`);
    if (version === env.DATA_ENCRYPTION_KEY_VERSION) throw new Error(`DATA_ENCRYPTION_PREVIOUS_KEYS must not reuse the current version ${version}`);
  }
  if (env.SENDGRID_API_KEY && !env.SENDGRID_API_KEY.startsWith('SG.')) {
    throw new Error('SENDGRID_API_KEY must be a SendGrid API key (starts with "SG.")');
  }
  if (!!env.VAPID_PUBLIC_KEY !== !!env.VAPID_PRIVATE_KEY) throw new Error('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (or neither) for browser notifications');
  if (env.WHATSAPP_PROVIDER === 'meta' && (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)) throw new Error('WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WHATSAPP_PROVIDER is meta');
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
    if (!env.METRICS_TOKEN) throw new Error('METRICS_TOKEN is required in production (Prometheus scrapes /api/v1/metrics with it)');
    if (env.AUDIT_ARCHIVE_RETENTION_DAYS < 1) throw new Error('AUDIT_ARCHIVE_RETENTION_DAYS must be at least 1 in production (archives are immutable)');
    if (env.DB_MIGRATION_USER && env.DB_MIGRATION_USER === env.DB_USER) {
      throw new Error('DB_USER (the API) must differ from DB_MIGRATION_USER (the schema owner) in production');
    }
  }
  return env;
}
