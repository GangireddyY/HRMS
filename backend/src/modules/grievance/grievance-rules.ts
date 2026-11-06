import {
  GRIEVANCE_REOPEN_DAYS,
  GRIEVANCE_RESOLUTION_DAYS,
  OPEN_GRIEVANCE_STATUSES,
  POSH_FILING_MONTHS,
  POSH_INQUIRY_DAYS,
  type GrievanceCategory,
  type GrievanceOutcome,
  type GrievanceStatus,
} from '../../contracts';
import { addDays } from '../../common/utils/zoned-time';

export const isPosh = (category: GrievanceCategory) => category === 'POSH';

/** Target date: 30 days for grievances, 90 days to complete a POSH inquiry. */
export const dueDate = (category: GrievanceCategory, submittedOn: string) => addDays(submittedOn, isPosh(category) ? POSH_INQUIRY_DAYS : GRIEVANCE_RESOLUTION_DAYS);

/** Calendar months later, clamped to the month end (31 Jan + 1 month = end of February). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Timeliness of a POSH complaint (section 9(1)): due within 3 months of the incident; the committee may extend that
 * by up to 3 months for reasons recorded in writing.
 */
export function poshFiling(incidentDate: string | null, submittedOn: string): 'ON_TIME' | 'LATE' | 'BEYOND_EXTENSION' {
  if (!incidentDate || submittedOn <= addMonths(incidentDate, POSH_FILING_MONTHS)) return 'ON_TIME';
  return submittedOn <= addMonths(incidentDate, 2 * POSH_FILING_MONTHS) ? 'LATE' : 'BEYOND_EXTENSION';
}

export const isOpen = (status: GrievanceStatus) => OPEN_GRIEVANCE_STATUSES.includes(status);
export const isOverdue = (c: { status: GrievanceStatus; dueOn: string }, today: string) => isOpen(c.status) && today > c.dueOn;

/** Notes and files can be added until the case is closed or withdrawn. */
export const acceptsUpdates = (status: GrievanceStatus) => status !== 'CLOSED' && status !== 'WITHDRAWN';

export interface ResolvedCase {
  category: GrievanceCategory;
  status: GrievanceStatus;
  reopened: boolean;
  resolvedOn: string | null;
  acceptedAt: Date | null;
}

export const reopenUntil = (resolvedOn: string) => addDays(resolvedOn, GRIEVANCE_REOPEN_DAYS);

/** The complainant may ask once, within 15 days, to reopen a resolved grievance. POSH findings are appealed outside (section 18). */
export function reopenBlocker(c: ResolvedCase, today: string): string | null {
  if (c.status !== 'RESOLVED' || !c.resolvedOn) return 'Only a resolved case can be reopened';
  if (isPosh(c.category)) return 'Internal Committee findings are appealed to the appellate authority within 90 days (section 18 of the POSH Act)';
  if (c.reopened) return 'This case has already been reopened once';
  if (today > reopenUntil(c.resolvedOn)) return `The case could be reopened until ${reopenUntil(c.resolvedOn)}`;
  return null;
}

/** A resolved case closes once the complainant accepts it or the reopening window has passed (POSH cases at any time). */
export function closeBlocker(c: ResolvedCase, today: string): string | null {
  if (c.status !== 'RESOLVED' || !c.resolvedOn) return 'Only a resolved case can be closed';
  if (isPosh(c.category) || c.acceptedAt || c.reopened) return null;
  if (today <= reopenUntil(c.resolvedOn)) return `The complainant can ask to reopen it until ${reopenUntil(c.resolvedOn)}`;
  return null;
}

export interface ReportCase {
  submittedOn: string;
  resolvedOn: string | null;
  withdrawnOn: string | null;
  outcome: GrievanceOutcome | null;
}

/**
 * POSH annual report figures for a calendar year (section 21, rule 14): complaints received, disposed of, withdrawn,
 * pending at the end of the year (or today for the current year) and pending for more than 90 days, and outcomes.
 */
export function poshAnnualReport(cases: ReportCase[], year: number, today: string) {
  const from = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const asOf = today < yearEnd ? today : yearEnd;
  const inYear = (d: string | null) => !!d && d >= from && d <= asOf;
  const pending = cases.filter((c) => c.submittedOn <= asOf && !(c.resolvedOn && c.resolvedOn <= asOf) && !(c.withdrawnOn && c.withdrawnOn <= asOf));
  const disposed = cases.filter((c) => inYear(c.resolvedOn));
  const outcomes: Partial<Record<GrievanceOutcome, number>> = {};
  for (const c of disposed) if (c.outcome) outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
  return {
    year,
    asOf,
    received: cases.filter((c) => inYear(c.submittedOn)).length,
    disposed: disposed.length,
    withdrawn: cases.filter((c) => inYear(c.withdrawnOn)).length,
    pending: pending.length,
    pendingOver90Days: pending.filter((c) => daysBetween(c.submittedOn, asOf) > POSH_INQUIRY_DAYS).length,
    outcomes,
  };
}
