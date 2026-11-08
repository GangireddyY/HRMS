import { appLocale } from '@/core/locale/locale';
import type { AnnouncementCategory, AnnouncementStatus, RecognitionBadge, RsvpResponse, SuggestionCategory, SuggestionStatus, SurveyQuestionType, SurveyStatus } from '@contracts';

export const CATEGORY_LABELS: Record<AnnouncementCategory, string> = { GENERAL: 'General', POLICY: 'Policy', EVENT: 'Event', CELEBRATION: 'Celebration', ALERT: 'Alert' };
export const categoryTone: Record<AnnouncementCategory, 'neutral' | 'info' | 'violet' | 'success' | 'danger'> = { GENERAL: 'neutral', POLICY: 'info', EVENT: 'violet', CELEBRATION: 'success', ALERT: 'danger' };
export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };
export const announcementTone: Record<AnnouncementStatus, 'neutral' | 'success' | 'warning'> = { DRAFT: 'neutral', PUBLISHED: 'success', ARCHIVED: 'warning' };
export const RSVP_LABELS: Record<RsvpResponse, string> = { GOING: 'Going', MAYBE: 'Maybe', NOT_GOING: "Can't go" };

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = { DRAFT: 'Draft', OPEN: 'Open', CLOSED: 'Closed' };
export const surveyTone: Record<SurveyStatus, 'neutral' | 'success' | 'warning'> = { DRAFT: 'neutral', OPEN: 'success', CLOSED: 'warning' };
export const QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = { RATING: 'Rating (1–5)', NPS: 'Likelihood to recommend (0–10)', CHOICE: 'Single choice', TEXT: 'Free text' };

export const BADGE_LABELS: Record<RecognitionBadge, string> = { TEAMWORK: 'Teamwork', INNOVATION: 'Innovation', CUSTOMER_FIRST: 'Customer first', OWNERSHIP: 'Ownership', EXCELLENCE: 'Excellence', HELPING_HAND: 'Helping hand' };
export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = { WORKPLACE: 'Workplace', PROCESS: 'Process', PRODUCT: 'Product', CULTURE: 'Culture', BENEFITS: 'Benefits', OTHER: 'Other' };
export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = { NEW: 'New', UNDER_REVIEW: 'Under review', ACCEPTED: 'Accepted', IMPLEMENTED: 'Implemented', DECLINED: 'Declined' };
export const suggestionTone: Record<SuggestionStatus, 'neutral' | 'info' | 'success' | 'brand' | 'danger'> = { NEW: 'neutral', UNDER_REVIEW: 'info', ACCEPTED: 'success', IMPLEMENTED: 'brand', DECLINED: 'danger' };

const when = new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const eventWhen = (a: { eventStartsAt: string | null; eventEndsAt: string | null }) =>
  a.eventStartsAt ? `${when.format(new Date(a.eventStartsAt))}${a.eventEndsAt ? ` – ${when.format(new Date(a.eventEndsAt))}` : ''}` : '';
