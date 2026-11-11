import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2500;

/** How often the hash suffix appears in a Pwned Passwords range response ("SUFFIX:COUNT" lines). */
export function countInRange(body: string, suffix: string): number {
  for (const line of body.split('\n')) {
    const [s, n] = line.trim().split(':');
    if (s?.toUpperCase() === suffix) return Number(n) || 0;
  }
  return 0;
}

export type RangeFetcher = (prefix: string) => Promise<string>;

/**
 * Checks new passwords against Have I Been Pwned's breached-password corpus with k-anonymity: only the first five hex
 * characters of the SHA-1 are sent (with response padding), never the password or its full hash. When the service
 * can't be reached in time the check is skipped, so sign-up and resets keep working.
 */
@Injectable()
export class BreachedPasswordService {
  private readonly logger = new Logger(BreachedPasswordService.name);
  /** Replaced in tests; the real one calls the Pwned Passwords API. */
  fetchRange: RangeFetcher = async (prefix) => {
    const res = await fetch(`${RANGE_URL}${prefix}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'HRMS password check' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };

  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.get('PASSWORD_BREACH_CHECK');
  }

  /** Times the password was seen in breaches; null when the check is off or unavailable. */
  async timesSeen(password: string): Promise<number | null> {
    if (!this.enabled) return null;
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    try {
      return countInRange(await this.fetchRange(sha1.slice(0, 5)), sha1.slice(5));
    } catch (e) {
      this.logger.warn(`Breached-password check skipped: ${(e as Error).message}`);
      return null;
    }
  }
}
