import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { parseKeyRing } from './encryption.service';

export type KeySource = 'env' | 'aws-kms';

/** Encryption context the data keys are generated with (`aws kms generate-data-key --encryption-context app=hrms`). */
export const KMS_ENCRYPTION_CONTEXT = { app: 'hrms', purpose: 'data-encryption-key' } as const;

export interface DataKeySpec {
  source: KeySource;
  /** `env`: the base64 key. `aws-kms`: the base64 CiphertextBlob of the data key. */
  key: string;
  /** Same format as DATA_ENCRYPTION_PREVIOUS_KEYS, with ciphertext blobs for `aws-kms`. */
  previous?: string;
  kmsRegion?: string;
}

type KmsLike = Pick<KMSClient, 'send'>;

/**
 * The plaintext data keys for EncryptionService. With `aws-kms` (envelope encryption) the configuration holds only
 * KMS-encrypted data keys; they are decrypted once at startup, so a leaked environment or secret store doesn't reveal
 * the keys without KMS access (which is logged in CloudTrail and can be revoked).
 */
export async function resolveDataKeys(spec: DataKeySpec, kms?: KmsLike): Promise<{ key: string; previous: Map<number, string> }> {
  const previous = parseKeyRing(spec.previous);
  if (spec.source === 'env') return { key: spec.key, previous };
  const client = kms ?? new KMSClient({ region: spec.kmsRegion });
  const unwrap = async (blob: string, label: string) => {
    try {
      const out = await client.send(new DecryptCommand({ CiphertextBlob: Buffer.from(blob, 'base64'), EncryptionContext: { ...KMS_ENCRYPTION_CONTEXT } }));
      if (!out.Plaintext || out.Plaintext.length !== 32) throw new Error('the decrypted data key is not 32 bytes (use --key-spec AES_256)');
      return Buffer.from(out.Plaintext).toString('base64');
    } catch (e) {
      throw new Error(`Could not decrypt ${label} with AWS KMS: ${(e as Error).message}`);
    }
  };
  const ring = new Map<number, string>();
  for (const [version, blob] of previous) ring.set(version, await unwrap(blob, `previous key ${version}`));
  return { key: await unwrap(spec.key, 'DATA_ENCRYPTION_KEY'), previous: ring };
}
