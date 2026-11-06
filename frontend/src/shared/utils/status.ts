type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const membershipTone: Record<string, Tone> = { ACTIVE: 'success', INVITED: 'info', SUSPENDED: 'danger' };
export const organizationTone: Record<string, Tone> = { ACTIVE: 'success', PENDING: 'warning', SUSPENDED: 'danger', DEACTIVATED: 'neutral' };
export const loginTone: Record<string, Tone> = { SUCCESS: 'success', FAILURE: 'danger', LOCKED: 'danger', MFA_CHALLENGE: 'info' };
export const scopeTone: Record<string, Tone> = { OWN: 'neutral', TEAM: 'info', DEPARTMENT: 'warning', ORGANIZATION: 'brand' };

export const SCOPE_LABELS: Record<string, string> = {
  OWN: 'Own records',
  TEAM: 'Team (direct reports)',
  DEPARTMENT: 'Department',
  ORGANIZATION: 'Entire organization',
};

const ACRONYMS = new Set(['MFA', 'IP', 'HR', 'SSO', 'API']);

/** Human label for API enum values: `MFA_CHALLENGE` → "MFA challenge", `ACTIVE` → "Active". */
export function statusLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.split('_').filter(Boolean);
  return words
    .map((w, i) => {
      const upper = w.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}
