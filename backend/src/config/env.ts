import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength, validateSync } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';
const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

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

  @Transform(toBool) @IsBoolean()
  COOKIE_SECURE = false;

  @IsString()
  MFA_ISSUER = 'HRMS';

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
  if (env.SENDGRID_API_KEY && !env.SENDGRID_API_KEY.startsWith('SG.')) {
    throw new Error('SENDGRID_API_KEY must be a SendGrid API key (starts with "SG.")');
  }
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (!env.SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY is required in production');
    if (env.SENDGRID_SANDBOX_MODE) throw new Error('SENDGRID_SANDBOX_MODE must be false in production');
    if (env.DB_USER === 'postgres') throw new Error('DB_USER must be a least-privilege role in production, not the postgres superuser');
  }
  return env;
}
