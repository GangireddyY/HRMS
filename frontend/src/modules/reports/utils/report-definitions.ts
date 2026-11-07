import type { Component } from 'vue';
import { Banknote, ClipboardList, LogOut, Plane, Users } from '@lucide/vue';
import { REPORT_META, type ReportKey, type ReportValueFormat } from '@contracts';

export type ValueFormat = ReportValueFormat;
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface ReportDefinition {
  key: ReportKey;
  title: string;
  description: string;
  icon: Component;
  permission: string;
  /** asOf: one day; range: a date range; months: a month range. */
  period: 'asOf' | 'range' | 'months';
  /** Default length of the range (days or months back from today). */
  defaultBack?: number;
  departmentFilter: boolean;
  summary: { key: string; label: string; format: ValueFormat; tone?: Tone }[];
  chart?: { key: string; label: string; format: ValueFormat };
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
      permission: 'reports.view',
      period: 'asOf',
      departmentFilter: true,
      chart: { key: 'headcount', label: 'Headcount at month end', format: 'number' },
    },
    { onNotice: 'warning', joinersLast30Days: 'success', averageTenureYears: 'info', womenShare: 'info' },
  ),
  define(
    'attrition',
    {
      description: 'Joiners, leavers and the attrition rate over a period, by department, type of exit, reason and length of service.',
      icon: LogOut,
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
      return `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
    case 'money':
      return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    case 'years':
      return `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })} years`;
    case 'days':
      return `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })} days`;
    default:
      return v.toLocaleString('en-IN', { maximumFractionDigits: 1 });
  }
}
