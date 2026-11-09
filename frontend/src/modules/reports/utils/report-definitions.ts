import { appLocale, INR_LOCALE } from '@/core/locale/locale';
import type { Component } from 'vue';
import { Banknote, ClipboardList, LogOut, Plane, Users } from '@lucide/vue';
import { REPORT_META, type ReportKey, type ReportValueFormat } from '@contracts';

export type ValueFormat = ReportValueFormat;
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export type ReportCategory = 'people' | 'time' | 'pay' | 'hiring';
/** Groups in the reports hub; `tile` colours the report icons of the group. */
export const REPORT_CATEGORIES: Record<ReportCategory, { label: string; description: string; icon: Component; tile: string }> = {
  people: { label: 'Workforce', description: 'Headcount, movement and composition', icon: Users, tile: 'bg-accent-soft text-accent-fg' },
  time: { label: 'Time off', description: 'Leave taken and requested', icon: Plane, tile: 'bg-info-soft text-info-fg' },
  pay: { label: 'Payroll', description: 'Cost of pay and contributions', icon: Banknote, tile: 'bg-success-soft text-success-fg' },
  hiring: { label: 'Hiring', description: 'Pipeline, offers and time to hire', icon: ClipboardList, tile: 'bg-special-soft text-special-fg' },
};
export const PERIOD_LABELS: Record<ReportDefinition['period'], string> = { asOf: 'On a day', range: 'Date range', months: 'Month range' };

export interface ReportDefinition {
  key: ReportKey;
  title: string;
  description: string;
  icon: Component;
  category: ReportCategory;
  /** What the tables break the figures down by, shown as tags in the hub. */
  breakdowns: string[];
  permission: string;
  /** asOf: one day; range: a date range; months: a month range. */
  period: 'asOf' | 'range' | 'months';
  /** Default length of the range (days or months back from today). */
  defaultBack?: number;
  departmentFilter: boolean;
  summary: { key: string; label: string; format: ValueFormat; tone?: Tone }[];
  /** `line` for levels (headcount), `bar` (default) for flows (cost per month). */
  chart?: { key: string; label: string; format: ValueFormat; kind?: 'bar' | 'line' };
}

/** Title and headline figures come from the shared report metadata (the exports use the same); tones are per screen. */
const define = (key: ReportKey, d: Omit<ReportDefinition, 'key' | 'title' | 'summary'>, tones: Partial<Record<string, Tone>> = {}): ReportDefinition => ({
  key,
  title: REPORT_META[key].title,
  summary: REPORT_META[key].summary.map((s) => ({ ...s, tone: tones[s.key] })),
  ...d,
});

export const REPORTS: ReportDefinition[] = [
  define(
    'headcount',
    {
      description: 'People on the payroll on a day, by department, location, type, gender and grade, with a 12-month trend.',
      icon: Users,
      category: 'people',
      breakdowns: ['Department', 'Location', 'Type', 'Gender', 'Grade', '12-month trend'],
      permission: 'reports.view',
      period: 'asOf',
      departmentFilter: true,
      chart: { key: 'headcount', label: 'Headcount at month end', format: 'number', kind: 'line' },
    },
    { onNotice: 'warning', joinersLast30Days: 'success', averageTenureYears: 'info', womenShare: 'info' },
  ),
  define(
    'attrition',
    {
      description: 'Joiners, leavers and the attrition rate over a period, by department, type of exit, reason and length of service.',
      icon: LogOut,
      category: 'people',
      breakdowns: ['Department', 'Exit type', 'Reason', 'Length of service'],
      permission: 'reports.view',
      period: 'range',
      defaultBack: 365,
      departmentFilter: true,
    },
    { leavers: 'danger', joiners: 'success', rate: 'warning', annualizedRate: 'warning', voluntary: 'info' },
  ),
  define(
    'leave',
    {
      description: 'Leave starting in a period by type, department and person.',
      icon: Plane,
      category: 'time',
      breakdowns: ['Leave type', 'Department', 'Person'],
      permission: 'reports.view',
      period: 'range',
      defaultBack: 90,
      departmentFilter: true,
    },
    { peopleOnLeave: 'info', daysPerEmployee: 'info', pending: 'warning' },
  ),
  define(
    'payroll-cost',
    {
      description: 'Gross pay, deductions, net pay and employer contributions of approved runs, by month and department.',
      icon: Banknote,
      category: 'pay',
      breakdowns: ['Month', 'Department', 'Monthly trend'],
      permission: 'reports.payroll.view',
      period: 'months',
      defaultBack: 11,
      departmentFilter: false,
      chart: { key: 'cost', label: 'Cost to company by month', format: 'money' },
    },
    { totalGross: 'info', employerContributions: 'info', averageMonthlyCost: 'success' },
  ),
  define(
    'recruitment',
    {
      description: 'Applications, hires, offers and time to hire over a period, by stage, source and job.',
      icon: ClipboardList,
      category: 'hiring',
      breakdowns: ['Stage', 'Source', 'Job'],
      permission: 'reports.recruitment.view',
      period: 'range',
      defaultBack: 180,
      departmentFilter: false,
    },
    { hired: 'success', conversion: 'info', acceptanceRate: 'info', medianDaysToHire: 'warning' },
  ),
];

export function formatValue(v: number | string | null | undefined, format: ValueFormat | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  switch (format) {
    case 'percent':
      return `${v.toLocaleString(appLocale(), { maximumFractionDigits: 1 })}%`;
    case 'money':
      return `₹${v.toLocaleString(INR_LOCALE, { maximumFractionDigits: 0 })}`;
    case 'years':
      return `${v.toLocaleString(appLocale(), { maximumFractionDigits: 1 })} year${v === 1 ? '' : 's'}`;
    case 'days':
      return `${v.toLocaleString(appLocale(), { maximumFractionDigits: 1 })} day${v === 1 ? '' : 's'}`;
    default:
      return v.toLocaleString(appLocale(), { maximumFractionDigits: 1 });
  }
}
