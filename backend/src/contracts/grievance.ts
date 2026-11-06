/**
 * Grievances and POSH complaints.
 * POSH cases (sexual harassment, Sexual Harassment of Women at Workplace Act 2013) are handled only by the Internal
 * Committee (`grievance.posh.access`); HR and Organization Admin never see them.
 */

export const GRIEVANCE_CATEGORIES = ['WORKPLACE', 'MANAGER', 'PAY_BENEFITS', 'DISCRIMINATION', 'HARASSMENT', 'SAFETY', 'POLICY', 'OTHER', 'POSH'] as const;
export type GrievanceCategory = (typeof GRIEVANCE_CATEGORIES)[number];

/**
 * SUBMITTED → IN_REVIEW (assigned / acknowledged) → INVESTIGATING → RESOLVED → CLOSED.
 * The complainant can withdraw before resolution, accept a resolution (closes it) or ask once to reopen it (not POSH).
 */
export const GRIEVANCE_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'INVESTIGATING', 'RESOLVED', 'CLOSED', 'WITHDRAWN'] as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[number];
export const OPEN_GRIEVANCE_STATUSES: readonly GrievanceStatus[] = ['SUBMITTED', 'IN_REVIEW', 'INVESTIGATING'];

export const GRIEVANCE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type GrievancePriority = (typeof GRIEVANCE_PRIORITIES)[number];

/** UPHELD / PARTIALLY_UPHELD / NOT_UPHELD after an investigation; SETTLED when resolved informally (conciliation for POSH). */
export const GRIEVANCE_OUTCOMES = ['UPHELD', 'PARTIALLY_UPHELD', 'NOT_UPHELD', 'SETTLED'] as const;
export type GrievanceOutcome = (typeof GRIEVANCE_OUTCOMES)[number];

/** SHARED notes and files are seen by the complainant; INTERNAL ones only by the people handling the case. */
export const GRIEVANCE_VISIBILITIES = ['SHARED', 'INTERNAL'] as const;
export type GrievanceVisibility = (typeof GRIEVANCE_VISIBILITIES)[number];

/** Target resolution time for grievances. */
export const GRIEVANCE_RESOLUTION_DAYS = 30;
/** POSH inquiry must be completed within 90 days (section 11(4)). */
export const POSH_INQUIRY_DAYS = 90;
/** POSH complaints are due within 3 months of the incident; the committee may extend this by 3 months (section 9(1)). */
export const POSH_FILING_MONTHS = 3;
/** A resolved grievance can be reopened by the complainant once within this many days; after that it can be closed. */
export const GRIEVANCE_REOPEN_DAYS = 15;
export const GRIEVANCE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const GRIEVANCE_MAX_ATTACHMENTS = 20;
