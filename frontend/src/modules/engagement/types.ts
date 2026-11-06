import type {
  AnnouncementCategory,
  AnnouncementStatus,
  RecognitionBadge,
  RsvpResponse,
  SuggestionCategory,
  SuggestionStatus,
  SurveyQuestionType,
  SurveyStatus,
} from '@contracts';

export interface PersonRef {
  id: string;
  name: string;
  employeeCode: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  requiresAck: boolean;
  departmentIds: string[] | null;
  locationIds: string[] | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventLocation: string | null;
  status: AnnouncementStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  mine: { acknowledgedAt: string | null; rsvp: RsvpResponse | null };
  counts?: { acknowledged: number; going: number; maybe: number; notGoing: number };
}

export interface AnnouncementInput {
  title: string;
  body: string;
  category?: AnnouncementCategory;
  pinned?: boolean;
  requiresAck?: boolean;
  departmentIds?: string[] | null;
  locationIds?: string[] | null;
  eventStartsAt?: string | null;
  eventEndsAt?: string | null;
  eventLocation?: string | null;
  expiresAt?: string | null;
}

export interface Tracking {
  audience: number;
  people: { employee: PersonRef & { department: string | null }; acknowledgedAt: string | null; rsvp: RsvpResponse | null }[];
}

export interface SurveyQuestion {
  id?: string;
  type: SurveyQuestionType;
  prompt: string;
  options: string[];
  required: boolean;
}

export interface SurveySummary {
  id: string;
  title: string;
  description: string | null;
  anonymous: boolean;
  departmentIds: string[] | null;
  status: SurveyStatus;
  open: boolean;
  openedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  createdAt: string;
  questions: number;
  responded: boolean;
  responses?: number;
}

export interface SurveyDetail extends Omit<SurveySummary, 'questions'> {
  questions: (SurveyQuestion & { id: string })[];
  permissions: { respond: boolean; manage: boolean };
}

export interface SurveyInput {
  title: string;
  description?: string | null;
  anonymous?: boolean;
  departmentIds?: string[] | null;
  closesAt?: string | null;
  questions: SurveyQuestion[];
}

export interface QuestionResult {
  questionId: string;
  type: SurveyQuestionType;
  prompt: string;
  answered: number;
  average?: number | null;
  nps?: { score: number | null; promoters: number; passives: number; detractors: number };
  distribution?: Record<number, number>;
  options?: string[];
  texts?: string[];
}

export interface SurveyResults {
  survey: Omit<SurveySummary, 'questions' | 'responded'>;
  responses: number;
  audience: number;
  responseRate: number | null;
  hidden: boolean;
  threshold: number;
  questions: QuestionResult[];
  respondents: string[] | null;
}

export interface Recognition {
  id: string;
  badge: RecognitionBadge;
  message: string;
  createdAt: string;
  giver: PersonRef | null;
  recipients: (PersonRef & { department: string | null })[];
  canDelete: boolean;
}

export interface RecognitionStats {
  thisMonth: number;
  topRecipients: { employee: PersonRef; count: number }[];
  mine: { received: number; given: number } | null;
}

export interface SuggestionItem {
  id: string;
  title: string;
  body: string;
  category: SuggestionCategory;
  status: SuggestionStatus;
  anonymous: boolean;
  author: PersonRef | null;
  response: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
}
