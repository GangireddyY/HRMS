import { describe, expect, it } from 'vitest';
import type { PublicJobDetail } from '@/modules/recruitment/types';
import { careersPlace, jobPostingLd } from './careers';

const job: PublicJobDetail = {
  id: 'job-1',
  title: 'Backend Engineer',
  department: { id: 'd1', name: 'Engineering' },
  location: { id: 'l1', name: 'Bengaluru office' },
  employmentType: 'CONTRACT',
  experienceMin: 3,
  experienceMax: 6,
  closesOn: '2026-12-31',
  postedAt: '2026-11-10T09:00:00.000Z',
  description: 'Build payment services.',
  requirements: 'Node.js',
  address: { city: 'Bengaluru', state: 'Karnataka', country: 'IN' },
};
const org = { name: 'Acme', website: 'https://acme.example', city: 'Mumbai', country: 'IN' };

describe('careers utilities', () => {
  it('names the employer place', () => {
    expect(careersPlace({ city: 'Pune', country: 'IN' }, 'en-IN')).toBe('Pune, India');
    expect(careersPlace({ city: null, country: null }, 'en-IN')).toBeNull();
  });

  it('describes a job for Google for Jobs', () => {
    const ld = jobPostingLd(org, job, 'https://hr.acme.example/careers/acme/jobs/job-1', 'https://hr.acme.example/logo.png');
    expect(ld).toMatchObject({
      '@type': 'JobPosting',
      title: 'Backend Engineer',
      description: 'Build payment services.\n\nRequirements:\nNode.js',
      datePosted: '2026-11-10',
      validThrough: '2026-12-31T23:59:59',
      employmentType: 'CONTRACTOR',
      hiringOrganization: { name: 'Acme', sameAs: 'https://acme.example', logo: 'https://hr.acme.example/logo.png' },
      jobLocation: { address: { addressLocality: 'Bengaluru', addressRegion: 'Karnataka', addressCountry: 'IN' } },
      occupationalCategory: 'Engineering',
      experienceRequirements: { monthsOfExperience: 36 },
      directApply: true,
    });
  });

  it('falls back to the employer city and leaves out what is unknown', () => {
    const ld = jobPostingLd({ ...org, website: null }, { ...job, address: undefined, closesOn: null, postedAt: null, experienceMin: null, department: null }, 'u', null);
    expect(ld).not.toHaveProperty('validThrough');
    expect(ld).not.toHaveProperty('datePosted');
    expect(ld).not.toHaveProperty('experienceRequirements');
    expect(ld).not.toHaveProperty('occupationalCategory');
    expect((ld.hiringOrganization as Record<string, unknown>).logo).toBeUndefined();
    expect((ld.jobLocation as { address: Record<string, unknown> }).address).toMatchObject({ addressLocality: 'Mumbai', addressCountry: 'IN' });
  });
});
