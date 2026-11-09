import type { Employee } from '@/modules/people/types';
import { daysUntil, relativeDays } from '@/modules/people/utils/dates';

export type SignalKind = 'leaving' | 'joining' | 'probation-overdue' | 'probation-due' | 'probation' | 'new';

export interface EmployeeSignal {
  kind: SignalKind;
  label: string;
  tone: 'danger' | 'warning' | 'info' | 'violet' | 'brand';
  /** Something HR should act on soon. */
  urgent: boolean;
}

/** Days ahead (and behind, for new joiners) that count as "soon". */
export const SIGNAL_WINDOW_DAYS = 30;

/** The one lifecycle fact worth flagging next to a person: leaving, joining, probation or newly joined. */
export function employeeSignal(e: Pick<Employee, 'status' | 'exitDate' | 'dateOfJoining' | 'probationEndDate' | 'confirmedOn'>): EmployeeSignal | null {
  if (e.status === 'EXITED') return null;
  if (e.status === 'ON_NOTICE') {
    if (!e.exitDate) return { kind: 'leaving', label: 'Serving notice', tone: 'warning', urgent: false };
    const d = daysUntil(e.exitDate);
    return { kind: 'leaving', label: d >= 0 ? `Last day ${relativeDays(e.exitDate)}` : `Last day was ${relativeDays(e.exitDate)}`, tone: 'warning', urgent: d <= SIGNAL_WINDOW_DAYS };
  }
  const joining = daysUntil(e.dateOfJoining);
  if (joining > 0) return { kind: 'joining', label: `Joins ${relativeDays(e.dateOfJoining)}`, tone: 'info', urgent: joining <= SIGNAL_WINDOW_DAYS };
  if (!e.confirmedOn && e.probationEndDate) {
    const d = daysUntil(e.probationEndDate);
    if (d < 0) return { kind: 'probation-overdue', label: `Probation ended ${relativeDays(e.probationEndDate)}`, tone: 'danger', urgent: true };
    if (d <= SIGNAL_WINDOW_DAYS) return { kind: 'probation-due', label: `Probation ends ${relativeDays(e.probationEndDate)}`, tone: 'warning', urgent: true };
    return { kind: 'probation', label: 'On probation', tone: 'violet', urgent: false };
  }
  if (-joining <= SIGNAL_WINDOW_DAYS) return { kind: 'new', label: joining === 0 ? 'Joins today' : `Joined ${relativeDays(e.dateOfJoining)}`, tone: 'brand', urgent: false };
  return null;
}
