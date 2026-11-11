export const BUILDER_DATASETS = ['employees', 'leave_requests', 'attendance', 'claims', 'payslips'] as const;
export type BuilderDataset = (typeof BUILDER_DATASETS)[number];
export const BUILDER_COLUMN_TYPES = ['text', 'number', 'money', 'date', 'boolean'] as const;
export type BuilderColumnType = (typeof BUILDER_COLUMN_TYPES)[number];
export const BUILDER_OPERATORS = ['eq', 'neq', 'in', 'contains', 'gte', 'lte', 'empty', 'not_empty'] as const;
export type BuilderOperator = (typeof BUILDER_OPERATORS)[number];

export const BUILDER_PREVIEW_ROWS = 500;
export const BUILDER_MAX_ROWS = 20_000;
export const BUILDER_MAX_COLUMNS = 40;

export interface BuilderColumn {
  key: string;
  label: string;
  type: BuilderColumnType;
  /** For pickers: "Employee", "Leave", "Custom fields"… */
  group: string;
  /** Known values, for "is one of" filters. */
  values?: string[];
}

export interface BuilderFilter {
  column: string;
  op: BuilderOperator;
  value?: string | number | boolean | string[] | null;
}

export interface BuilderQuery {
  dataset: BuilderDataset;
  columns: string[];
  filters?: BuilderFilter[];
  sort?: { column: string; direction: 'asc' | 'desc' } | null;
  /** Summarize: one row per value of this column, with a count and totals of the numeric columns. */
  groupBy?: string | null;
  /** Dated datasets: the period (YYYY-MM-DD). */
  from?: string;
  to?: string;
}

// ---- Scheduled reports ------------------------------------------------------------------------

export const REPORT_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];
export const REPORT_FREQUENCY_LABELS: Record<ReportFrequency, string> = { DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month' };
/** Monthly schedules run on day 1 to 28, so every month has the day. */
export const REPORT_MAX_MONTH_DAY = 28;
export const REPORT_MAX_RECIPIENTS = 20;

/** The period a scheduled run covers (dated datasets); SAVED keeps the dates saved with the report. */
export const REPORT_PERIODS = ['PREVIOUS_DAY', 'PREVIOUS_WEEK', 'PREVIOUS_MONTH', 'MONTH_TO_DATE', 'LAST_30_DAYS', 'SAVED'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  PREVIOUS_DAY: 'Yesterday',
  PREVIOUS_WEEK: 'Last week (Monday to Sunday)',
  PREVIOUS_MONTH: 'Last month',
  MONTH_TO_DATE: 'This month so far',
  LAST_30_DAYS: 'The last 30 days',
  SAVED: 'The dates saved with the report',
};
export const REPORT_RUN_STATUSES = ['SENT', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
export type ReportRunStatus = (typeof REPORT_RUN_STATUSES)[number];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const shift = (date: string, days: number) => isoDay(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));

/** The from/to dates a period covers on `today` (the organization's date); null for SAVED. */
export function reportPeriod(period: ReportPeriod, today: string): { from: string; to: string } | null {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (period) {
    case 'PREVIOUS_DAY':
      return { from: shift(today, -1), to: shift(today, -1) };
    case 'PREVIOUS_WEEK': {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
      const monday = shift(today, -dow - 7);
      return { from: monday, to: shift(monday, 6) };
    }
    case 'PREVIOUS_MONTH': {
      const first = isoDay(new Date(Date.UTC(y, m - 2, 1)));
      return { from: first, to: isoDay(new Date(Date.UTC(y, m - 1, 0))) };
    }
    case 'MONTH_TO_DATE':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'LAST_30_DAYS':
      return { from: shift(today, -29), to: today };
    case 'SAVED':
      return null;
  }
}

export interface ReportScheduleView {
  id: string;
  savedReportId: string;
  reportName: string;
  dataset: BuilderDataset;
  frequency: ReportFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  format: 'csv' | 'xlsx';
  period: ReportPeriod;
  recipients: { userId: string; name: string; email: string }[];
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: ReportRunStatus | null;
  lastError: string | null;
}
