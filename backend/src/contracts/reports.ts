/** Reports: HR (headcount, attrition, leave), payroll cost and recruitment. */

export const REPORT_KEYS = ['headcount', 'attrition', 'leave', 'payroll-cost', 'recruitment'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/** Permission needed for each report (exports also need `reports.export`). */
export const REPORT_PERMISSIONS: Record<ReportKey, string> = {
  headcount: 'reports.view',
  attrition: 'reports.view',
  leave: 'reports.view',
  'payroll-cost': 'reports.payroll.view',
  recruitment: 'reports.recruitment.view',
};

export interface ReportColumn {
  key: string;
  label: string;
  /** Numbers are right-aligned; `percent` and `money` say how to show them. */
  format?: 'number' | 'percent' | 'money' | 'date';
}

export interface ReportTable {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}

/** Longest date range a report covers (two years). */
export const MAX_REPORT_DAYS = 731;
