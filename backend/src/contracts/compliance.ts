/**
 * Compliance: company policies with versions and employee acknowledgements, and a calendar of statutory filings.
 */

export const POLICY_CATEGORIES = ['CODE_OF_CONDUCT', 'HR', 'LEAVE', 'IT_SECURITY', 'DATA_PRIVACY', 'HEALTH_SAFETY', 'ANTI_BRIBERY', 'POSH', 'TRAVEL', 'OTHER'] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/** DRAFT (never published) → PUBLISHED (a current version is in force) → RETIRED. */
export const POLICY_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** A version is drafted, published, and superseded by the next published version. */
export const POLICY_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'SUPERSEDED'] as const;
export type PolicyVersionStatus = (typeof POLICY_VERSION_STATUSES)[number];

export const COMPLIANCE_CATEGORIES = ['PF', 'ESI', 'TDS', 'PT', 'LWF', 'GRATUITY', 'POSH', 'LABOUR', 'OTHER'] as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];

/** Calendar occurrences: DONE (filed), OVERDUE, DUE_SOON (within 7 days) or UPCOMING. */
export const FILING_STATES = ['DONE', 'OVERDUE', 'DUE_SOON', 'UPCOMING'] as const;
export type FilingState = (typeof FILING_STATES)[number];

export const DEFAULT_ACK_DUE_DAYS = 14;
export const DUE_SOON_DAYS = 7;
/** Overdue filings are looked for this far back. */
export const FILING_LOOKBACK_MONTHS = 12;
export const POLICY_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILING_FILE_MAX_BYTES = 5 * 1024 * 1024;
