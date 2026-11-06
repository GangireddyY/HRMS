/** Employee engagement: announcements and events, surveys, recognition and suggestions. */

export const ANNOUNCEMENT_CATEGORIES = ['GENERAL', 'POLICY', 'EVENT', 'CELEBRATION', 'ALERT'] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const RSVP_RESPONSES = ['GOING', 'MAYBE', 'NOT_GOING'] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

/** DRAFT (questions editable) → OPEN (accepting responses until closed or the closing time passes) → CLOSED. */
export const SURVEY_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

/**
 * RATING 1–5; NPS 0–10 ("how likely are you to recommend…", scored as eNPS); CHOICE one of the options; TEXT free text.
 */
export const SURVEY_QUESTION_TYPES = ['RATING', 'NPS', 'CHOICE', 'TEXT'] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

/** Anonymous results are only shown once at least this many people have responded. */
export const ANONYMITY_THRESHOLD = 3;
export const MAX_SURVEY_QUESTIONS = 40;

export const RECOGNITION_BADGES = ['TEAMWORK', 'INNOVATION', 'CUSTOMER_FIRST', 'OWNERSHIP', 'EXCELLENCE', 'HELPING_HAND'] as const;
export type RecognitionBadge = (typeof RECOGNITION_BADGES)[number];
export const MAX_RECOGNITION_RECIPIENTS = 10;

export const SUGGESTION_CATEGORIES = ['WORKPLACE', 'PROCESS', 'PRODUCT', 'CULTURE', 'BENEFITS', 'OTHER'] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export const SUGGESTION_STATUSES = ['NEW', 'UNDER_REVIEW', 'ACCEPTED', 'IMPLEMENTED', 'DECLINED'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
