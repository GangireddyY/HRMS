import type { ClearanceDepartment, ClearanceStatus, DailyRateBasis, EmploymentType, ExitLetterType, ExitReason, ExitStatus, ExitType, SettlementStatus } from '@contracts';

export interface ExitSummary {
  id: string;
  employee: { id: string; name: string; employeeCode: string; department: string | null; designation: string | null; dateOfJoining: string; employmentType: EmploymentType } | null;
  type: ExitType;
  reason: ExitReason;
  status: ExitStatus;
  submittedOn: string;
  noticeDays: number;
  noticeEndsOn: string;
  requestedLastDay: string | null;
  lastWorkingDay: string | null;
  noticeWaived: boolean;
  shortfallDays: number;
  daysLeft: number | null;
  clearance: { total: number; done: number };
  createdAt: string;
  settlement: { status: SettlementStatus; netPayable: number; dueOn: string; overdue: boolean } | null;
}

export interface ClearanceItem {
  id: string;
  department: ClearanceDepartment;
  title: string;
  status: ClearanceStatus;
  recoveryAmount: number;
  note: string | null;
  clearedBy: string | null;
  clearedAt: string | null;
}

export interface ExitFeedback {
  submittedAt: string;
  wouldRecommend: number;
  wouldRejoin: boolean;
  liked: string | null;
  improve: string | null;
}

export interface ExitDetail extends ExitSummary {
  reasonDetail: string | null;
  service: { years: number; months: number; days: number };
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  completedAt: string | null;
  completedBy: string | null;
  closedReason: string | null;
  closedAt: string | null;
  clearanceItems: ClearanceItem[];
  feedback?: ExitFeedback | null;
  feedbackGiven: boolean;
  eligibleForRehire?: boolean | null;
  rehireNote?: string | null;
  permissions: {
    self: boolean;
    manage: boolean;
    approve: boolean;
    clear: boolean;
    clearManager: boolean;
    withdraw: boolean;
    feedback: boolean;
    complete: boolean;
    completeBlocker: string | null;
    cancel: boolean;
    settle: boolean;
    letters: boolean;
  };
}

export interface ExitLetterSummary {
  id: string;
  type: ExitLetterType;
  reference: string;
  letterDate: string;
  subject: string;
  signatoryName: string;
  signatoryTitle: string | null;
  issuedBy: string | null;
  issuedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
}

export interface ExitLetter extends ExitLetterSummary {
  body: string;
  employee: { name: string; employeeCode: string };
  letterhead: { name: string; logoUrl: string | null; address: string[]; email: string | null; phone: string | null; website: string | null; registrationNumber: string | null };
}

export interface LetterDraft {
  type: ExitLetterType;
  letterDate: string;
  subject: string;
  body: string;
  signatoryName: string;
  signatoryTitle: string | null;
}

export interface AlumniDetails {
  optedIn: boolean;
  personalEmail: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  city: string | null;
  openToOpportunities: boolean;
  updatedAt: string | null;
}

export interface MyAlumni {
  eligible: boolean;
  joined: boolean;
  profile: AlumniDetails | null;
}

export interface AlumniRow {
  id: string;
  name: string;
  employeeCode: string;
  department: string | null;
  designation: string | null;
  dateOfJoining: string;
  exitDate: string | null;
  exit: { id: string; type: ExitType; reason: ExitReason; lastWorkingDay: string | null; eligibleForRehire?: boolean | null } | null;
  optedIn: boolean;
  alumni: AlumniDetails | null;
}

export interface SettlementLine {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
  detail: string | null;
}

export interface Adjustment {
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
}

export interface Settlement {
  id: string;
  status: SettlementStatus;
  employee: { name: string; employeeCode: string; department: string | null; designation: string | null; dateOfJoining: string };
  lastWorkingDay: string | null;
  exitType: ExitType;
  lines: SettlementLine[];
  totalEarnings: number;
  totalDeductions: number;
  netPayable: number;
  dueOn: string;
  overdue: boolean;
  paidOn: string | null;
  paymentReference: string | null;
  approvedAt: string | null;
  /** Only for payroll.settlement.manage. */
  encashmentBasis?: DailyRateBasis;
  noticeBasis?: DailyRateBasis;
  includeGratuity?: boolean;
  gratuityNote?: string | null;
  adjustments?: Adjustment[];
  inputs?: {
    asOf: string;
    monthlyBasic: number;
    monthlyGross: number;
    salaryEffectiveFrom: string;
    service: { years: number; months: number; days: number };
    gratuityYears: number;
    gratuity: { eligible: boolean; basis: string };
    leave: { code: string; name: string; days: number }[];
    shortfallDays: number;
    noticeWaived: boolean;
  };
  returnedNote?: string | null;
  calculatedBy?: string | null;
  calculatedAt?: string | null;
  submittedBy?: string | null;
  approvedBy?: string | null;
  permissions?: { calculate: boolean; submit: boolean; approve: boolean; returnToDraft: boolean; pay: boolean };
}
