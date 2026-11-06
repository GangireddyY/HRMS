/** Employee master-data vocabularies shared by the API and the web app. */

export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'EXITED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const GENDERS = ['MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED'] as const;
export type Gender = (typeof GENDERS)[number];

export const LIFECYCLE_EVENT_TYPES = ['JOINED', 'TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'CONFIRMATION', 'PROBATION_EXTENDED'] as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

/** Lifecycle changes an HR user can record (JOINED is written when the employee is created). */
export const LIFECYCLE_ACTIONS = ['TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'CONFIRMATION'] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'UNDISCLOSED'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const FAMILY_RELATIONSHIPS = ['SPOUSE', 'CHILD', 'FATHER', 'MOTHER', 'SIBLING', 'OTHER'] as const;
export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];

export const EDUCATION_LEVELS = ['SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'DOCTORATE', 'CERTIFICATION', 'OTHER'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const DOCUMENT_CATEGORIES = ['IDENTITY', 'ADDRESS', 'EDUCATION', 'EXPERIENCE', 'OFFER_LETTER', 'CONTRACT', 'CERTIFICATION', 'MEDICAL', 'OTHER'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Accepted employee document types, detected from the file contents (never from the name or the client's MIME type). */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Largest CSV import, in rows. */
export const EMPLOYEE_IMPORT_MAX_ROWS = 10_000;

/** Indian PAN, e.g. ABCDE1234F. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** Indian IFSC, e.g. HDFC0001234. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** EPFO Universal Account Number (12 digits). */
export const UAN_PATTERN = /^[0-9]{12}$/;
/** Aadhaar number (12 digits, does not start with 0 or 1). */
export const AADHAAR_PATTERN = /^[2-9][0-9]{11}$/;
/** Passport number: letters and digits, 6–12 characters. */
export const PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/;
