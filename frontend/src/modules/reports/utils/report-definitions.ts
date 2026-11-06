import type { Component } from 'vue';
import { Banknote, ClipboardList, LogOut, Plane, Users } from '@lucide/vue';
import type { ReportKey } from '@contracts';

export type ValueFormat = 'number' | 'percent' | 'money' | 'date' | 'years' | 'days';

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
  summary: { key: string; label: string; format: ValueFormat; tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info' }[];
  chart?: { key: string; label: string; format: ValueFormat };
}

export const REPORTS: ReportDefinition[] = [
  {
    key: 'headcount',
    title: 'Headcount',
    description: 'People on the payroll on a day, by department, location, type, gender and grade, with a 12-month trend.',
    icon: Users,
    permission: 'reports.view',
    period: 'asOf',
    departmentFilter: true,
    summary: [
      { key: 'headcount', label: 'Headcount', format: 'number' },
      { key: 'onNotice', label: 'Serving notice', format: 'number', tone: 'warning' },
      { key: 'joinersLast30Days', label: 'Joined in the last 30 days', format: 'number', tone: 'success' },
      { key: 'averageTenureYears', label: 'Average tenure', format: 'years', tone: 'info' },
      { key: 'womenShare', label: 'Women', format: 'percent', tone: 'info' },
    ],
    chart: { key: 'headcount', label: 'Headcount at month end', format: 'number' },
  },
  {
    key: 'attrition',
    title: 'Attrition',
    description: 'Joiners, leavers and the attrition rate over a period, by department, type of exit, reason and length of service.',
    icon: LogOut,
    permission: 'reports.view',
    period: 'range',
    defaultBack: 365,
    departmentFilter: true,
    summary: [
      { key: 'leavers', label: 'Leavers', format: 'number', tone: 'danger' },
      { key: 'joiners', label: 'Joiners', format: 'number', tone: 'success' },
      { key: 'rate', label: 'Attrition (period)', format: 'percent', tone: 'warning' },
      { key: 'annualizedRate', label: 'Attrition (annualized)', format: 'percent', tone: 'warning' },
      { key: 'voluntary', label: 'Resignations', format: 'number', tone: 'info' },
    ],
  },
  {
    key: 'leave',
    title: 'Leave',
    description: 'Leave starting in a period by type, department and person.',
    icon: Plane,
    permission: 'reports.view',
    period: 'range',
    defaultBack: 90,
    departmentFilter: true,
    summary: [
      { key: 'approvedDays', label: 'Days taken', format: 'days' },
      { key: 'peopleOnLeave', label: 'People who took leave', format: 'number', tone: 'info' },
      { key: 'daysPerEmployee', label: 'Days per person', format: 'days', tone: 'info' },
      { key: 'pending', label: 'Pending requests', format: 'number', tone: 'warning' },
    ],
  },
  {
    key: 'payroll-cost',
    title: 'Payroll cost',
    description: 'Gross pay, deductions, net pay and employer contributions of approved runs, by month and department.',
    icon: Banknote,
    permission: 'reports.payroll.view',
    period: 'months',
    defaultBack: 11,
    departmentFilter: false,
    summary: [
      { key: 'costToCompany', label: 'Cost to company', format: 'money' },
      { key: 'totalGross', label: 'Gross pay', format: 'money', tone: 'info' },
      { key: 'employerContributions', label: 'Employer contributions', format: 'money', tone: 'info' },
      { key: 'averageMonthlyCost', label: 'Average per month', format: 'money', tone: 'success' },
    ],
    chart: { key: 'cost', label: 'Cost to company by month', format: 'money' },
  },
  {
    key: 'recruitment',
    title: 'Recruitment',
    description: 'Applications, hires, offers and time to hire over a period, by stage, source and job.',
    icon: ClipboardList,
    permission: 'reports.recruitment.view',
    period: 'range',
    defaultBack: 180,
    departmentFilter: false,
    summary: [
      { key: 'applications', label: 'Applications', format: 'number' },
      { key: 'hired', label: 'Hired', format: 'number', tone: 'success' },
      { key: 'conversion', label: 'Applications hired', format: 'percent', tone: 'info' },
      { key: 'acceptanceRate', label: 'Offers accepted', format: 'percent', tone: 'info' },
      { key: 'medianDaysToHire', label: 'Median days to hire', format: 'days', tone: 'warning' },
    ],
  },
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
