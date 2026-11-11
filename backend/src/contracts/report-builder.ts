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
