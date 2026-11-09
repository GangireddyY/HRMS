import type { Component } from 'vue';
import {
  Award,
  Banknote,
  Building2,
  CalendarDays,
  CalendarRange,
  ChartPie,
  Clock,
  FileSignature,
  Gauge,
  Hourglass,
  Inbox,
  LogOut,
  Percent,
  Plane,
  Timer,
  TrendingDown,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from '@lucide/vue';
import type { ReportColumn, ReportKey, ReportTable } from '@contracts';
import type { ReportResult } from '@/modules/reports/api/reports.api';
import { formatValue } from '@/modules/reports/utils/report-definitions';

export type KpiTone = 'brand' | 'success' | 'warning' | 'danger' | 'info';
export const KPI_TILE: Record<KpiTone, string> = {
  brand: 'bg-accent-soft text-accent-fg',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
};

/** Icon and a one-line definition for every headline figure, so each number explains itself. */
export const KPI_META: Record<string, { icon: Component; hint: string }> = {
  headcount: { icon: Users, hint: 'People on the payroll on the day' },
  onNotice: { icon: Hourglass, hint: 'Resigned and working their notice' },
  joinersLast30Days: { icon: UserPlus, hint: 'Started in the 30 days before the day' },
  averageTenureYears: { icon: Award, hint: 'Average time since joining' },
  womenShare: { icon: ChartPie, hint: 'Of people with a recorded gender' },
  leavers: { icon: UserMinus, hint: 'Last working day in the period' },
  joiners: { icon: UserPlus, hint: 'Joined during the period' },
  rate: { icon: TrendingDown, hint: 'Leavers ÷ average headcount' },
  annualizedRate: { icon: CalendarRange, hint: 'The period rate scaled to a year' },
  voluntary: { icon: LogOut, hint: 'Leavers who resigned' },
  approvedDays: { icon: CalendarDays, hint: 'Approved leave starting in the period' },
  peopleOnLeave: { icon: Plane, hint: 'Took at least one day off' },
  daysPerEmployee: { icon: Gauge, hint: 'Days taken ÷ headcount' },
  pending: { icon: Clock, hint: 'Requests still waiting for a decision' },
  costToCompany: { icon: Wallet, hint: 'Gross pay plus employer contributions' },
  totalGross: { icon: Banknote, hint: 'Before deductions, approved and paid runs' },
  employerContributions: { icon: Building2, hint: 'PF, ESI and other employer costs' },
  averageMonthlyCost: { icon: CalendarRange, hint: 'Cost to company per month in the range' },
  applications: { icon: Inbox, hint: 'Received in the period' },
  hired: { icon: UserCheck, hint: 'Applications that ended in a hire' },
  conversion: { icon: Percent, hint: 'Hires ÷ applications' },
  acceptanceRate: { icon: FileSignature, hint: 'Accepted ÷ answered offers' },
  medianDaysToHire: { icon: Timer, hint: 'From application to hire, middle value' },
};

/** Which monthly trend series sits behind a headline figure (only some reports return a trend). */
const SPARK_SERIES: Partial<Record<ReportKey, Record<string, string>>> = {
  headcount: { headcount: 'headcount' },
  'payroll-cost': { costToCompany: 'cost', totalGross: 'gross', employerContributions: 'employer', averageMonthlyCost: 'cost' },
};
export function sparkFor(report: ReportKey, kpi: string, result: ReportResult | null | undefined): number[] | null {
  const series = SPARK_SERIES[report]?.[kpi];
  const values = series && result?.trend ? result.trend.map((t) => Number(t[series] ?? 0)) : [];
  return values.length >= 2 ? values : null;
}

/** Categorical colours from theme variables, so charts follow the palette and dark mode. */
export const SERIES_COLORS = ['var(--brand-500)', 'var(--status-info)', 'var(--status-special)', 'var(--status-caution)', 'var(--status-away)', 'var(--status-success)', 'var(--status-warning)', 'var(--brand-300)'];

const isNumeric = (format?: string) => !!format && format !== 'date';

export interface ChartSpec {
  /** Column with the category names. */
  label: string;
  /** Column the bar length follows. */
  bar: ReportColumn;
  /** Column shown next to the bar, if any. */
  aside: ReportColumn | null;
  /** True when the bars are parts of one whole (a donut works). */
  whole: boolean;
}
const PREFERRED = ['days', 'cost', 'count', 'people', 'applications', 'employees'];
const isShare = (c: ReportColumn) => c.format === 'percent' && (c.key === 'share' || /^share/i.test(c.label));

/**
 * A breakdown that reads better as a chart: a label column, 2–12 rows, not a list of people and not a month series.
 * Shares chart the count (parts of a whole); rates such as attrition or conversion chart the rate itself.
 */
export function chartable(t: ReportTable): ChartSpec | null {
  const [first, ...rest] = t.columns;
  if (!first || isNumeric(first.format) || first.key === 'month' || t.columns.some((c) => c.key === 'code') || t.rows.length < 2 || t.rows.length > 12) return null;
  const numbers = rest.filter((c) => c.format === 'number' || c.format === 'money');
  const main = PREFERRED.map((k) => numbers.find((c) => c.key === k)).find(Boolean) ?? numbers[0];
  const percent = rest.find((c) => c.format === 'percent');
  if (percent && !isShare(percent)) return { label: first.key, bar: percent, aside: main ?? null, whole: false };
  if (!main) return null;
  return { label: first.key, bar: main, aside: percent ?? null, whole: !!percent };
}
/** Share tables (label, count, share) open as a chart; richer tables open as a table with a chart one click away. */
export const chartFirst = (t: ReportTable) => t.columns.length <= 3 && !!chartable(t)?.whole;

/** Plain-language takeaways from the tables: who leads each breakdown. */
export function highlights(result: ReportResult): string[] {
  const out: string[] = [];
  for (const t of result.tables) {
    const c = chartable(t);
    if (!c) continue;
    const metric = c.whole && c.aside ? c.aside : c.bar;
    const top = [...t.rows].sort((a, b) => Number(b[metric.key] ?? 0) - Number(a[metric.key] ?? 0))[0]!;
    const topValue = Number(top[metric.key] ?? 0);
    if (!topValue) continue;
    const value = formatValue(topValue, metric.format as never);
    const name = top[c.label];
    if (c.whole) {
      const group = t.columns[0]!.label.toLowerCase();
      out.push(`${name} is the largest group by ${group} (${value}${/^share$/i.test(metric.label) ? '' : ` ${metric.label.toLowerCase()}`}).`);
    } else out.push(`${name} has the ${metric.format === 'percent' ? 'highest' : 'most'} ${metric.label.toLowerCase()} (${value}).`);
    if (out.length === 4) break;
  }
  return out;
}
