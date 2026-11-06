import type { ComplianceCategory, FilingState, PolicyCategory, PolicyStatus } from '@contracts';
import type { AckState } from '../types';

export const POLICY_CATEGORY_LABELS: Record<PolicyCategory, string> = {
  CODE_OF_CONDUCT: 'Code of conduct',
  HR: 'HR',
  LEAVE: 'Leave & attendance',
  IT_SECURITY: 'IT & security',
  DATA_PRIVACY: 'Data privacy',
  HEALTH_SAFETY: 'Health & safety',
  ANTI_BRIBERY: 'Anti-bribery',
  POSH: 'POSH',
  TRAVEL: 'Travel & expenses',
  OTHER: 'Other',
};
export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', RETIRED: 'Retired' };
export const policyTone: Record<PolicyStatus, 'neutral' | 'success' | 'warning'> = { DRAFT: 'neutral', PUBLISHED: 'success', RETIRED: 'warning' };

export const ACK_LABELS: Record<AckState, string> = { ACKNOWLEDGED: 'Acknowledged', PENDING: 'To acknowledge', OVERDUE: 'Overdue' };
export const ackTone: Record<AckState, 'success' | 'warning' | 'danger'> = { ACKNOWLEDGED: 'success', PENDING: 'warning', OVERDUE: 'danger' };

export const OBLIGATION_CATEGORY_LABELS: Record<ComplianceCategory, string> = {
  PF: 'Provident fund',
  ESI: 'ESI',
  TDS: 'Income tax (TDS)',
  PT: 'Professional tax',
  LWF: 'Labour welfare fund',
  GRATUITY: 'Gratuity',
  POSH: 'POSH',
  LABOUR: 'Labour laws',
  OTHER: 'Other',
};
export const FILING_STATE_LABELS: Record<FilingState, string> = { DONE: 'Filed', OVERDUE: 'Overdue', DUE_SOON: 'Due soon', UPCOMING: 'Upcoming' };
export const filingTone: Record<FilingState, 'success' | 'danger' | 'warning' | 'neutral'> = { DONE: 'success', OVERDUE: 'danger', DUE_SOON: 'warning', UPCOMING: 'neutral' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "01-15" → "15 Jan"; twelve dates on the same day → "15th of every month". */
export function scheduleLabel(dueDates: string[]): string {
  const days = new Set(dueDates.map((d) => d.slice(3)));
  if (dueDates.length === 12 && days.size === 1) return `${Number([...days][0])} of every month`;
  return dueDates.map((d) => `${Number(d.slice(3))} ${MONTHS[Number(d.slice(0, 2)) - 1]}`).join(', ');
}

export const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
