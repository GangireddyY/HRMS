import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id with the OWASP Password Storage baseline (m=19 MiB, t=2, p=1). */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordHasher {
  /** Hash used to equalise timing when the user does not exist or has no password. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, { ...OPTIONS });
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      this.dummyHash ??= argon2.hash('timing-equaliser-password', { ...OPTIONS });
      const dummy = await this.dummyHash;
      await argon2.verify(dummy, password).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
