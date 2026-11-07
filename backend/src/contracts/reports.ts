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
  format?: Exclude<ReportValueFormat, 'years' | 'days'>;
}

export interface ReportTable {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}

export const REPORT_EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export type ReportValueFormat = 'number' | 'percent' | 'money' | 'date' | 'years' | 'days';

/** Each report's title and headline figures (keys of its `summary`), shared by the screens and the exports. */
export const REPORT_META: Record<ReportKey, { title: string; summary: { key: string; label: string; format: ReportValueFormat }[] }> = {
  headcount: {
    title: 'Headcount',
    summary: [
      { key: 'headcount', label: 'Headcount', format: 'number' },
      { key: 'onNotice', label: 'Serving notice', format: 'number' },
      { key: 'joinersLast30Days', label: 'Joined in the last 30 days', format: 'number' },
      { key: 'averageTenureYears', label: 'Average tenure', format: 'years' },
      { key: 'womenShare', label: 'Women', format: 'percent' },
    ],
  },
  attrition: {
    title: 'Attrition',
    summary: [
      { key: 'leavers', label: 'Leavers', format: 'number' },
      { key: 'joiners', label: 'Joiners', format: 'number' },
      { key: 'rate', label: 'Attrition (period)', format: 'percent' },
      { key: 'annualizedRate', label: 'Attrition (annualized)', format: 'percent' },
      { key: 'voluntary', label: 'Resignations', format: 'number' },
    ],
  },
  leave: {
    title: 'Leave',
    summary: [
      { key: 'approvedDays', label: 'Days taken', format: 'days' },
      { key: 'peopleOnLeave', label: 'People who took leave', format: 'number' },
      { key: 'daysPerEmployee', label: 'Days per person', format: 'days' },
      { key: 'pending', label: 'Pending requests', format: 'number' },
    ],
  },
  'payroll-cost': {
    title: 'Payroll cost',
    summary: [
      { key: 'costToCompany', label: 'Cost to company', format: 'money' },
      { key: 'totalGross', label: 'Gross pay', format: 'money' },
      { key: 'employerContributions', label: 'Employer contributions', format: 'money' },
      { key: 'averageMonthlyCost', label: 'Average per month', format: 'money' },
    ],
  },
  recruitment: {
    title: 'Recruitment',
    summary: [
      { key: 'applications', label: 'Applications', format: 'number' },
      { key: 'hired', label: 'Hired', format: 'number' },
      { key: 'conversion', label: 'Applications hired', format: 'percent' },
      { key: 'acceptanceRate', label: 'Offers accepted', format: 'percent' },
      { key: 'medianDaysToHire', label: 'Median days to hire', format: 'days' },
    ],
  },
};

/** Longest date range a report covers (two years). */
export const MAX_REPORT_DAYS = 731;
