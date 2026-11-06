import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service';
import { PasswordHasher } from './password-hasher.service';
import { generateRecoveryCode, generateToken, normalizeRecoveryCode, safeEqual, sha256 } from './tokens';

describe('EncryptionService', () => {
  const service = new EncryptionService(randomBytes(32).toString('base64'));

  it('round-trips plaintext', () => {
    const cipher = service.encrypt('JBSWY3DPEHPK3PXP');
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(service.decrypt(cipher)).toBe('JBSWY3DPEHPK3PXP');
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
