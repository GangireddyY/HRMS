/** Audit trail and login history archives, shared by the API and the web app. */

/** Which log an archive holds. */
export const LOG_ARCHIVE_KINDS = ['AUDIT_LOG', 'LOGIN_HISTORY'] as const;
export type LogArchiveKind = (typeof LOG_ARCHIVE_KINDS)[number];

/** ARCHIVED = the file is saved and the records are still there; PURGED = the archived records were deleted. */
export const LOG_ARCHIVE_STATUSES = ['ARCHIVED', 'PURGED'] as const;
export type LogArchiveStatus = (typeof LOG_ARCHIVE_STATUSES)[number];

/** Larger ranges are archived in several parts (pick an earlier date first). */
export const LOG_ARCHIVE_MAX_RECORDS = 100_000;
