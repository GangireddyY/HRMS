import { createCipheriv, randomBytes } from 'node:crypto';
import { EncryptionService, fieldContext, parseKeyRing } from './encryption.service';
import { PasswordHasher } from './password-hasher.service';
import { generateRecoveryCode, generateToken, normalizeRecoveryCode, safeEqual, sha256 } from './tokens';

describe('EncryptionService', () => {
  const service = new EncryptionService(randomBytes(32).toString('base64'));

  it('round-trips plaintext', () => {
    const cipher = service.encrypt('JBSWY3DPEHPK3PXP');
    expect(cipher.startsWith('k1:')).toBe(true);
    expect(service.decrypt(cipher)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('binds ciphertext to its field context', () => {
    const a = fieldContext('employees', 'pan', 'emp-a');
    const cipher = service.encrypt('ABCDE1234F', a);
    expect(service.decrypt(cipher, a)).toBe('ABCDE1234F');
    expect(() => service.decrypt(cipher, fieldContext('employees', 'pan', 'emp-b'))).toThrow();
    expect(() => service.decrypt(cipher, fieldContext('employees', 'uan', 'emp-a'))).toThrow();
  });

  it('reads the earlier v1 format (no context) and flags it for re-encryption', () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update('legacy', 'utf8'), c.final()]);
    const legacy = ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
    const svc = new EncryptionService(key.toString('base64'));
    expect(svc.decrypt(legacy, 'any context')).toBe('legacy');
    expect(svc.isStale(legacy)).toBe(true);
    expect(svc.isStale(svc.encrypt('x'))).toBe(false);
  });

  it('rotates keys: new values use the current version, old ones still decrypt', () => {
    const oldKey = randomBytes(32).toString('base64');
    const before = new EncryptionService(oldKey, 1);
    const written = before.encrypt('secret', 'ctx');
    const after = new EncryptionService(randomBytes(32).toString('base64'), 2, parseKeyRing(`1:${oldKey}`));
    expect(after.decrypt(written, 'ctx')).toBe('secret');
    expect(after.isStale(written)).toBe(true);
    expect(after.encrypt('secret', 'ctx').startsWith('k2:')).toBe(true);
    expect(() => new EncryptionService(randomBytes(32).toString('base64'), 2).decrypt(written, 'ctx')).toThrow(/version 1/);
  });

  it('treats plain text as legacy in lenient columns', () => {
    expect(service.decryptLenient('12 MG Road', 'ctx')).toBe('12 MG Road');
    expect(service.decryptLenient(service.encrypt('12 MG Road', 'ctx'), 'ctx')).toBe('12 MG Road');
    expect(service.decryptLenient(null, 'ctx')).toBeNull();
  });

  it('uses a random IV so equal plaintexts differ', () => {
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('detects tampering via the GCM auth tag', () => {
    const [v, iv, tag, data] = service.encrypt('secret').split(':');
    const tampered = Buffer.from(data, 'base64');
    tampered[0] ^= 0xff;
    expect(() => service.decrypt([v, iv, tag, tampered.toString('base64')].join(':'))).toThrow();
  });

  it('cannot decrypt with a different key', () => {
    const other = new EncryptionService(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(service.encrypt('secret'))).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new EncryptionService(randomBytes(16).toString('base64'))).toThrow();
  });
});

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with argon2id and verifies', async () => {
    const hash = await hasher.hash('Str0ng!Passw0rd');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(hasher.verify(hash, 'Str0ng!Passw0rd')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('returns false for missing or malformed hashes', async () => {
    await expect(hasher.verify(null, 'x')).resolves.toBe(false);
    await expect(hasher.verify('not-a-hash', 'x')).resolves.toBe(false);
  });
});

describe('token helpers', () => {
  it('generates unique url-safe tokens', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes deterministically', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('formats and normalises recovery codes', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code.replace(/-/g, ''));
  });

  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
