import { DEMO_PASSWORD, type Kit } from './kit';

const SNEHA = 'sneha@acme.test';
const ISHAAN = 'intern@acme.test';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

/** Sign-in trouble for Login history and the audit log: mistyped passwords and an account lockout. */
export async function seedSecurityExtras(kit: Kit): Promise<void> {
  await kit.step('Security: Sneha mistypes her password twice, then signs in', () => mistypedPassword(kit));
  await kit.step('Security: Ishaan locked out after repeated wrong passwords (lock cleared again)', () => lockout(kit));
}

async function attempt(kit: Kit, email: string, password: string, userAgent: string): Promise<string> {
  const res = await fetch(`${kit.base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify({ email, password }),
  });
  return res.ok ? 'OK' : await res.text();
}

const has = async (kit: Kit, email: string, outcome: string) =>
  (await kit.sql<{ n: number }>(`SELECT count(*)::int AS n FROM login_events WHERE organization_id = :orgId AND lower(email) = lower(:email) AND outcome = :outcome`, { email, outcome }))[0]!.n > 0;

/** Moves the person's sign-in events from the last few minutes back to a moment in the past, keeping their order. */
async function backdate(kit: Kit, email: string, daysAgo: number, time: string) {
  await kit.sql(
    `UPDATE login_events SET created_at = (:day || 'T' || :time || ':00+05:30')::timestamptz + (created_at - (SELECT min(created_at) FROM login_events WHERE lower(email) = lower(:email) AND created_at > now() - interval '5 minutes'))
      WHERE lower(email) = lower(:email) AND created_at > now() - interval '5 minutes'`,
    { email, day: kit.day(-daysAgo), time },
  );
}

async function mistypedPassword(kit: Kit) {
  if (await has(kit, SNEHA, 'FAILURE')) return 'skipped';
  for (const wrong of ['Demo@hrms2026', 'Demo@Hrms2025']) await attempt(kit, SNEHA, wrong, PHONE);
  const ok = await attempt(kit, SNEHA, DEMO_PASSWORD, PHONE);
  if (ok !== 'OK') throw new Error(`Sneha could not sign in after the mistakes: ${ok.slice(0, 200)}`);
  await backdate(kit, SNEHA, 1, '09:12');
}

/**
 * Wrong passwords until the lockout policy trips, one more try while locked, then the lock is lifted so the demo
 * account stays usable. Not backdated: the matching "account locked" audit entry can't be moved (append-only).
 */
async function lockout(kit: Kit) {
  if (await has(kit, ISHAAN, 'LOCKED')) return 'skipped';
  // Wrong guesses never reveal the lock (only the right password does), so the database says when it tripped.
  const isLocked = async () => (await kit.sql<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE lower(email) = lower(:email) AND locked_until > now()`, { email: ISHAAN }))[0]!.n > 0;
  let locked = false;
  for (let i = 0; i < 12 && !locked; i++) {
    await attempt(kit, ISHAAN, `Wrong-guess-${i}`, FIREFOX);
    locked = await isLocked();
  }
  if (!locked) throw new Error('The account never locked; check the organization lockout policy');
  await attempt(kit, ISHAAN, 'Wrong-guess-while-locked', FIREFOX);
  await kit.sql(`UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE lower(email) = lower(:email)`, { email: ISHAAN });
}
