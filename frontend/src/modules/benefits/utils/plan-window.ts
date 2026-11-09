import type { Plan } from '@/modules/benefits/types';
import { daysUntil } from '@/modules/benefits/utils/benefit-visuals';
import { formatDate } from '@/shared/utils/format';

export type WindowState = 'open' | 'upcoming' | 'closed' | 'none';

/** Where a plan's open enrolment window stands today, with a short label and badge tone for HR lists. */
export function enrolmentWindow(p: Pick<Plan, 'enrollmentOpensOn' | 'enrollmentClosesOn'>): {
  state: WindowState;
  label: string;
  detail: string;
  tone: 'success' | 'info' | 'neutral';
  daysLeft: number | null;
} {
  if (!p.enrollmentOpensOn || !p.enrollmentClosesOn) return { state: 'none', label: 'No window', detail: 'Changes only after a life event', tone: 'neutral', daysLeft: null };
  const toOpen = daysUntil(p.enrollmentOpensOn);
  const toClose = daysUntil(p.enrollmentClosesOn);
  if (toOpen > 0) return { state: 'upcoming', label: `Opens ${formatDate(p.enrollmentOpensOn)}`, detail: `in ${toOpen} day${toOpen === 1 ? '' : 's'}`, tone: 'info', daysLeft: null };
  if (toClose >= 0)
    return { state: 'open', label: 'Enrolment open', detail: toClose === 0 ? 'closes today' : `${toClose} day${toClose === 1 ? '' : 's'} left`, tone: 'success', daysLeft: toClose };
  return { state: 'closed', label: 'Enrolment closed', detail: `closed ${formatDate(p.enrollmentClosesOn)}`, tone: 'neutral', daysLeft: null };
}

/** Policy period relative to today: "Ends in 4 months", "Starts in 12 days", "Ended". */
export function policyTiming(p: Pick<Plan, 'coverageStartsOn' | 'coverageEndsOn'>): string {
  const toStart = daysUntil(p.coverageStartsOn);
  const toEnd = daysUntil(p.coverageEndsOn);
  const span = (n: number) => (n >= 60 ? `${Math.round(n / 30)} months` : `${n} day${n === 1 ? '' : 's'}`);
  if (toStart > 0) return `Starts in ${span(toStart)}`;
  if (toEnd >= 0) return toEnd === 0 ? 'Ends today' : `Ends in ${span(toEnd)}`;
  return 'Ended';
}
