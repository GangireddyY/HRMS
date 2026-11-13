import type { EmploymentType } from '@contracts';
import type { CareersOrganization, PublicJob, PublicJobDetail } from '@/modules/recruitment/types';
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

const SCHEMA_EMPLOYMENT: Record<EmploymentType, string> = { FULL_TIME: 'FULL_TIME', PART_TIME: 'PART_TIME', CONTRACT: 'CONTRACTOR', INTERN: 'INTERN' };

/** schema.org JobPosting, so Google for Jobs (and other search engines) can list the job. */
export function jobPostingLd(o: Pick<CareersOrganization, 'name' | 'website' | 'city' | 'country'>, j: PublicJobDetail, url: string, logo: string | null): Record<string, unknown> {
  const a = j.address;
  const experienceMonths = j.experienceMin ? j.experienceMin * 12 : null;
  return {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: j.title,
    description: [j.description, j.requirements && `Requirements:\n${j.requirements}`].filter(Boolean).join('\n\n'),
    identifier: { '@type': 'PropertyValue', name: o.name, value: j.id },
    ...(j.postedAt ? { datePosted: j.postedAt.slice(0, 10) } : {}),
    ...(j.closesOn ? { validThrough: `${j.closesOn}T23:59:59` } : {}),
    employmentType: SCHEMA_EMPLOYMENT[j.employmentType],
    hiringOrganization: { '@type': 'Organization', name: o.name, ...(o.website ? { sameAs: o.website } : {}), ...(logo ? { logo } : {}) },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: a?.city ?? o.city ?? undefined, addressRegion: a?.state ?? undefined, addressCountry: a?.country ?? o.country ?? undefined },
    },
    ...(j.department ? { occupationalCategory: j.department.name } : {}),
    ...(experienceMonths ? { experienceRequirements: { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: experienceMonths } } : {}),
    directApply: true,
    url,
  };
}
