import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const FORMAT = /^([vk])(\d{1,4}):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]*)$/;

/** Where an encrypted value lives (`table.column:rowId`); bound to the ciphertext so it can't be moved to another row or field. */
export const fieldContext = (table: string, column: string, id: string) => `${table}.${column}:${id}`;

/** `1:<base64>,2:<base64>` (previous keys, still needed to read values written with them). */
export function parseKeyRing(spec: string | undefined): Map<number, string> {
  const ring = new Map<number, string>();
  for (const part of (spec ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^v?(\d{1,4}):(.+)$/.exec(part);
    if (!m) throw new Error('DATA_ENCRYPTION_PREVIOUS_KEYS must look like "1:<base64 key>,2:<base64 key>"');
    ring.set(Number(m[1]), m[2]!);
  }
  return ring;
}

/**
 * Field-level encryption (AES-256-GCM) for sensitive data: MFA secrets, bank accounts, statutory and identity numbers,
 * contact details, grievance case files.
 *
 * Format: `k<version>:<iv>:<tag>:<ciphertext>` (base64), authenticated with the field context as additional data.
 * `v<version>:…` values are the earlier format without a context; they still decrypt, and `npm run db:reencrypt`
 * upgrades them. Rotation: set a new `DATA_ENCRYPTION_KEY` and `DATA_ENCRYPTION_KEY_VERSION`, move the old key to
 * `DATA_ENCRYPTION_PREVIOUS_KEYS`, deploy, run the re-encrypt job, then drop the old key.
 */
@Injectable()
export class EncryptionService {
  private readonly keys = new Map<number, Buffer>();

  constructor(
    base64Key: string,
    private readonly version = 1,
    previous: Map<number, string> = new Map(),
  ) {
    if (!Number.isInteger(version) || version < 1) throw new Error('Encryption key version must be a positive integer');
    for (const [v, k] of [...previous, [version, base64Key] as const]) {
      const key = Buffer.from(k, 'base64');
      if (key.length !== 32) throw new Error(`Encryption key ${v} must be 32 bytes`);
      this.keys.set(v, key);
    }
  }

  get currentVersion(): number {
    return this.version;
  }

  encrypt(plaintext: string, context = ''): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.keys.get(this.version)!, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [`k${this.version}`, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
  }

  decrypt(payload: string, context = ''): string {
    const m = FORMAT.exec(payload);
    if (!m) throw new Error('Unsupported ciphertext format');
    const [, kind, version, ivB64, tagB64, dataB64] = m;
    const key = this.keys.get(Number(version));
    if (!key) throw new Error(`No encryption key for version ${version} (add it to DATA_ENCRYPTION_PREVIOUS_KEYS)`);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64!, 'base64'));
    if (kind === 'k') decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64!, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Whether a stored value is ciphertext at all (contact fields written before they were encrypted are plain text). */
  isCiphertext(value: string): boolean {
    return FORMAT.test(value);
  }

  /** For columns that may still hold plain text from before encryption: decrypts ciphertext, returns anything else as is. */
  decryptLenient(value: string | null, context: string): string | null {
    if (value === null) return null;
    return this.isCiphertext(value) ? this.decrypt(value, context) : value;
  }

  /** True when the value isn't yet in the current format and key (what the re-encrypt job rewrites). */
  isStale(value: string): boolean {
    return !value.startsWith(`k${this.version}:`);
  }
}
