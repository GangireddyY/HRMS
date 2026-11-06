/** Employee master-data vocabularies shared by the API and the web app. */

export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'EXITED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const GENDERS = ['MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED'] as const;
export type Gender = (typeof GENDERS)[number];

export const LIFECYCLE_EVENT_TYPES = ['JOINED', 'TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'CONFIRMATION'] as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

/** Lifecycle changes an HR user can record (JOINED is written when the employee is created). */
export const LIFECYCLE_ACTIONS = ['TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'CONFIRMATION'] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** Indian PAN, e.g. ABCDE1234F. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** Indian IFSC, e.g. HDFC0001234. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** EPFO Universal Account Number (12 digits). */
export const UAN_PATTERN = /^[0-9]{12}$/;
