import type { CareersOrganization, PublicJob } from '@/modules/recruitment/types';
import { daysSince, daysUntil } from '@/modules/recruitment/utils/recruitment-ui';

/** "Bengaluru, India" from the employer's city and ISO country code. */
export function careersPlace(o: Pick<CareersOrganization, 'city' | 'country'>, locale: string): string | null {
  let country: string | null = null;
  try {
    country = o.country ? (new Intl.DisplayNames([locale], { type: 'region' }).of(o.country) ?? o.country) : null;
  } catch {
    country = o.country;
  }
  return [o.city, country].filter(Boolean).join(', ') || null;
}

/** Badges a job seeker cares about: freshly posted (last 7 days) and closing within two weeks. */
export function jobFlags(j: Pick<PublicJob, 'postedAt' | 'closesOn'>): { label: string; class: string }[] {
  const out: { label: string; class: string }[] = [];
  if (j.postedAt && daysSince(j.postedAt) <= 7) out.push({ label: 'New', class: 'bg-accent-soft text-accent-fg' });
  if (j.closesOn) {
    const n = daysUntil(j.closesOn);
    if (n >= 0 && n <= 14) out.push({ label: n === 0 ? 'Closes today' : n === 1 ? 'Closes tomorrow' : `Closes in ${n} days`, class: 'bg-warning-soft text-warning-fg' });
  }
  return out;
}
