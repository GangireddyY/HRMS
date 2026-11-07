/** Exits: resignations and other separations, notice, clearance and full & final settlement. */

export const EXIT_TYPES = ['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'DEATH', 'OTHER'] as const;
export type ExitType = (typeof EXIT_TYPES)[number];
/** Separations initiated by the employer: notice not given is paid in lieu instead of recovered. */
export const EMPLOYER_INITIATED_EXITS: readonly ExitType[] = ['TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'OTHER'];

export const EXIT_REASONS = [
  'BETTER_OPPORTUNITY',
  'COMPENSATION',
  'CAREER_GROWTH',
  'RELOCATION',
  'HIGHER_STUDIES',
  'PERSONAL',
  'HEALTH',
  'WORK_ENVIRONMENT',
  'MANAGER',
  'PERFORMANCE',
  'MISCONDUCT',
  'REDUNDANCY',
  'OTHER',
] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

/** SUBMITTED (resignation awaiting acceptance) → APPROVED (serving notice) → COMPLETED; or WITHDRAWN / CANCELLED. */
export const EXIT_STATUSES = ['SUBMITTED', 'APPROVED', 'COMPLETED', 'WITHDRAWN', 'CANCELLED'] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];
export const OPEN_EXIT_STATUSES: readonly ExitStatus[] = ['SUBMITTED', 'APPROVED'];

export const CLEARANCE_DEPARTMENTS = ['MANAGER', 'IT', 'ADMIN', 'FINANCE', 'HR'] as const;
export type ClearanceDepartment = (typeof CLEARANCE_DEPARTMENTS)[number];
export const CLEARANCE_STATUSES = ['PENDING', 'CLEARED', 'NOT_APPLICABLE'] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

/** Clearance steps added to every exit when it is approved (more can be added per case). */
export const DEFAULT_CLEARANCE: { department: ClearanceDepartment; title: string }[] = [
  { department: 'MANAGER', title: 'Work handed over' },
  { department: 'IT', title: 'Laptop and devices returned' },
  { department: 'IT', title: 'System access and accounts revoked' },
  { department: 'ADMIN', title: 'ID card and access card returned' },
  { department: 'FINANCE', title: 'Advances, loans and expense claims settled' },
  { department: 'HR', title: 'Exit interview done and documents collected' },
];

/** DRAFT (being worked out) → SUBMITTED → APPROVED (by someone else) → PAID. */
export const SETTLEMENT_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** Daily rate for leave encashment and notice pay: monthly Basic ÷ 26 or ÷ 30, or monthly gross ÷ 30. */
export const DAILY_RATE_BASES = ['BASIC_26', 'BASIC_30', 'GROSS_30'] as const;
export type DailyRateBasis = (typeof DAILY_RATE_BASES)[number];

export const DEFAULT_NOTICE_DAYS = 30;
/** Payment of Gratuity Act: 5 years of continuous service (none on death); fixed-term employees after 1 year. */
export const GRATUITY_MIN_YEARS = 5;
export const FIXED_TERM_GRATUITY_MIN_YEARS = 1;
/** Ceiling on gratuity (₹20 lakh). */
export const GRATUITY_CAP = 2_000_000;
/** Wages due on separation are paid within two working days (Code on Wages, section 17(2)). */
export const SETTLEMENT_DUE_WORKING_DAYS = 2;

/** Letters issued once an exit is completed. */
export const EXIT_LETTER_TYPES = ['RELIEVING', 'EXPERIENCE'] as const;
export type ExitLetterType = (typeof EXIT_LETTER_TYPES)[number];
/** Reference prefixes: REL-0001, EXP-0001… numbered separately per organization. */
export const EXIT_LETTER_PREFIX: Record<ExitLetterType, string> = { RELIEVING: 'REL', EXPERIENCE: 'EXP' };
