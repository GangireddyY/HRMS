import { DUE_SOON_DAYS, type ComplianceCategory, type EmploymentType, type FilingState } from '../../contracts';
import { addDays } from '../../common/utils/zoned-time';

export interface Audience {
  departmentIds: string[] | null;
  locationIds: string[] | null;
  employmentTypes: EmploymentType[] | null;
}

const listed = <T>(list: T[] | null, value: T | null) => !list?.length || (value !== null && list.includes(value));

/** Whether a policy applies to the employee (empty filters = everyone). */
export const inAudience = (a: Audience, e: { departmentId: string | null; locationId: string | null; employmentType: EmploymentType }) =>
  listed(a.departmentIds, e.departmentId) && listed(a.locationIds, e.locationId) && listed(a.employmentTypes, e.employmentType);

export interface PublishedVersion {
  version: number;
  reacknowledge: boolean;
  publishedOn: string;
}

/**
 * The version employees must have acknowledged (or a later one): the latest published with "acknowledge again", or the
 * first version. Minor updates published without it keep earlier acknowledgements valid.
 */
export function acknowledgementBasis(versions: PublishedVersion[]): PublishedVersion | null {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  if (!sorted.length) return null;
  return [...sorted].reverse().find((v) => v.reacknowledge) ?? sorted[0]!;
}

/** Acknowledgements are due a number of days after the version was published, or after joining for later joiners. */
export const ackDueOn = (basisPublishedOn: string, dateOfJoining: string, days: number) => addDays(basisPublishedOn > dateOfJoining ? basisPublishedOn : dateOfJoining, days);

export type AckState = 'ACKNOWLEDGED' | 'PENDING' | 'OVERDUE';

export function ackState(acknowledgedVersions: number[], basis: number, dueOn: string, today: string): AckState {
  if (acknowledgedVersions.some((v) => v >= basis)) return 'ACKNOWLEDGED';
  return today > dueOn ? 'OVERDUE' : 'PENDING';
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Problems with a yearly schedule of "MM-DD" due dates. */
export function scheduleProblems(dueDates: string[]): string[] {
  if (!dueDates.length) return ['Add at least one due date'];
  if (dueDates.length > 24) return ['Up to 24 due dates a year'];
  const bad = dueDates.filter((d) => !MMDD.test(d));
  if (bad.length) return [`Use month-day dates such as 01-15 (not ${bad.join(', ')})`];
  if (new Set(dueDates).size !== dueDates.length) return ['The same due date is listed twice'];
  return [];
}

/** A yearly "MM-DD" in a given year; days past the end of the month mean its last day (02-30 → 28 / 29 Feb). */
export function dateIn(year: number, mmdd: string): string {
  const [m, d] = mmdd.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Due dates of an obligation between two dates (inclusive), within its active period, in order. */
export function occurrences(o: { dueDates: string[]; startsOn: string; endsOn: string | null }, from: string, to: string): string[] {
  const start = from > o.startsOn ? from : o.startsOn;
  const end = o.endsOn && o.endsOn < to ? o.endsOn : to;
  if (start > end) return [];
  const out = new Set<string>();
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    for (const mmdd of o.dueDates) {
      const d = dateIn(y, mmdd);
      if (d >= start && d <= end) out.add(d);
    }
  }
  return [...out].sort();
}

export function filingState(dueOn: string, filed: boolean, today: string): FilingState {
  if (filed) return 'DONE';
  if (dueOn < today) return 'OVERDUE';
  return dueOn <= addDays(today, DUE_SOON_DAYS) ? 'DUE_SOON' : 'UPCOMING';
}

const monthly = (day: number) => Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);

/**
 * A starting set of Indian statutory obligations for employers. State-specific items (professional tax, POSH report)
 * carry a note to check the local due date; HR reviews and edits them after adding.
 */
export const RECOMMENDED_OBLIGATIONS: { title: string; category: ComplianceCategory; authority: string; description: string; dueDates: string[] }[] = [
  { title: 'PF contributions and ECR', category: 'PF', authority: 'EPFO', description: 'Pay provident fund contributions and file the electronic challan-cum-return for the previous month.', dueDates: monthly(15) },
  { title: 'ESI contributions', category: 'ESI', authority: 'ESIC', description: 'Pay employee state insurance contributions for the previous month.', dueDates: monthly(15) },
  {
    title: 'TDS deposit on salaries',
    category: 'TDS',
    authority: 'Income Tax Department',
    description: 'Deposit tax deducted from salaries in the previous month (for March: by 30 April).',
    dueDates: monthly(7).map((d) => (d === '04-07' ? '04-30' : d)),
  },
  { title: 'TDS return (Form 24Q)', category: 'TDS', authority: 'Income Tax Department', description: 'Quarterly statement of tax deducted from salaries.', dueDates: ['01-31', '05-31', '07-31', '10-31'] },
  { title: 'Form 16 to employees', category: 'TDS', authority: 'Income Tax Department', description: 'Issue Form 16 (salary TDS certificate) for the previous financial year.', dueDates: ['06-15'] },
  { title: 'Professional tax', category: 'PT', authority: 'State commercial taxes department', description: 'Pay professional tax deducted in the previous month. The due day differs by state — check and adjust.', dueDates: monthly(20) },
  { title: 'POSH annual report', category: 'POSH', authority: 'District Officer', description: 'Internal Committee annual report (section 21). The deadline differs by state — check and adjust.', dueDates: ['01-31'] },
];
