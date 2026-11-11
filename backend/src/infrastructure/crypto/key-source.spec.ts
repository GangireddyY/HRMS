import { randomBytes } from 'node:crypto';
import { DecryptCommand } from '@aws-sdk/client-kms';
import { EncryptionService } from './encryption.service';
import { KMS_ENCRYPTION_CONTEXT, resolveDataKeys } from './key-source';

describe('resolveDataKeys', () => {
  it('uses the configured key as-is for the env source', async () => {
    const key = randomBytes(32).toString('base64');
    const old = randomBytes(32).toString('base64');
    const out = await resolveDataKeys({ source: 'env', key, previous: `1:${old}` });
    expect(out.key).toBe(key);
    expect(out.previous.get(1)).toBe(old);
  });

  it('decrypts the data keys with KMS (envelope encryption) and the fixed encryption context', async () => {
    const current = randomBytes(32);
    const old = randomBytes(32);
    const blobs = new Map([
      ['blob-current', current],
      ['blob-old', old],
    ]);
    const calls: DecryptCommand[] = [];
    const kms = {
      send: jest.fn(async (cmd: DecryptCommand) => {
        calls.push(cmd);
        const id = Buffer.from(cmd.input.CiphertextBlob!).toString('utf8');
        return { Plaintext: new Uint8Array(blobs.get(id)!) };
      }),
    };
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    const out = await resolveDataKeys({ source: 'aws-kms', key: b64('blob-current'), previous: `1:${b64('blob-old')}` }, kms as never);
    expect(Buffer.from(out.key, 'base64').equals(current)).toBe(true);
    expect(Buffer.from(out.previous.get(1)!, 'base64').equals(old)).toBe(true);
    expect(calls.every((c) => JSON.stringify(c.input.EncryptionContext) === JSON.stringify(KMS_ENCRYPTION_CONTEXT))).toBe(true);
    // The unwrapped keys work with the encryption service.
    const crypto = new EncryptionService(out.key, 2, out.previous);
    expect(crypto.decrypt(crypto.encrypt('secret', 'ctx'), 'ctx')).toBe('secret');
  });

  it('fails startup clearly when KMS refuses or returns the wrong key size', async () => {
    const denied = { send: async () => Promise.reject(new Error('AccessDeniedException')) };
    await expect(resolveDataKeys({ source: 'aws-kms', key: 'YQ==' }, denied as never)).rejects.toThrow(/Could not decrypt DATA_ENCRYPTION_KEY with AWS KMS: AccessDeniedException/);
    const short = { send: async () => ({ Plaintext: new Uint8Array(16) }) };
    await expect(resolveDataKeys({ source: 'aws-kms', key: 'YQ==' }, short as never)).rejects.toThrow(/not 32 bytes/);
  });
});
