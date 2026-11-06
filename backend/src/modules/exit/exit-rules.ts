import {
  EMPLOYER_INITIATED_EXITS,
  FIXED_TERM_GRATUITY_MIN_YEARS,
  GRATUITY_CAP,
  GRATUITY_MIN_YEARS,
  type DailyRateBasis,
  type EmploymentType,
  type ExitType,
} from '../../contracts';
import { addDays, weekday } from '../../common/utils/zoned-time';

/** The last day of the notice period, counting the resignation day as day one. */
export const noticeEnd = (submittedOn: string, noticeDays: number) => addDays(submittedOn, noticeDays - 1);

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Notice days not served when the last working day is before the end of the notice period (unless waived). */
export const noticeShortfall = (noticeEndsOn: string, lastWorkingDay: string, waived: boolean) => (waived ? 0 : Math.max(0, daysBetween(lastWorkingDay, noticeEndsOn)));

/** Length of service from the joining date to the last working day (both included). */
export function serviceLength(joined: string, lastDay: string): { years: number; months: number; days: number } {
  const [fy, fm, fd] = joined.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = addDays(lastDay, 1).split('-').map(Number) as [number, number, number];
  let years = ty - fy;
  let months = tm - fm;
  let days = td - fd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: years < 0 ? 0 : months, days: years < 0 ? 0 : days };
}

/** Years counted for gratuity: completed years, plus one for a part year of six months or more. */
export const gratuityYears = (s: { years: number; months: number }) => s.years + (s.months >= 6 ? 1 : 0);

/**
 * Gratuity is payable after 5 years of continuous service, on death without a minimum, and to fixed-term (contract)
 * employees after 1 year.
 */
export function gratuityEligibility(type: ExitType, employmentType: EmploymentType, service: { years: number }): { eligible: boolean; basis: string } {
  if (type === 'DEATH') return { eligible: true, basis: 'Payable on death regardless of length of service' };
  const min = employmentType === 'CONTRACT' ? FIXED_TERM_GRATUITY_MIN_YEARS : GRATUITY_MIN_YEARS;
  const eligible = service.years >= min;
  return { eligible, basis: `${eligible ? 'Eligible' : 'Not eligible'}: ${service.years} completed year${service.years === 1 ? '' : 's'} of service (${min} needed${employmentType === 'CONTRACT' ? ' for fixed-term employees' : ''})` };
}

/** 15 days' wages (Basic) for every year counted, a month being 26 working days; capped at ₹20 lakh. */
export const gratuityAmount = (monthlyBasic: number, years: number) => Math.min(GRATUITY_CAP, Math.round((monthlyBasic * 15 * years) / 26));

export function dailyRate(basis: DailyRateBasis, monthlyBasic: number, monthlyGross: number): number {
  if (basis === 'BASIC_26') return monthlyBasic / 26;
  if (basis === 'BASIC_30') return monthlyBasic / 30;
  return monthlyGross / 30;
}

/** A date a number of working days later, not counting Saturdays and Sundays. */
export function addWorkingDays(date: string, n: number): string {
  let d = date;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const w = weekday(d);
    if (w !== 0 && w !== 6) left--;
  }
  return d;
}

export interface SettlementInput {
  type: ExitType;
  monthlyBasic: number;
  monthlyGross: number;
  encashment: { code: string; name: string; days: number }[];
  encashmentBasis: DailyRateBasis;
  gratuity: { include: boolean; years: number } | null;
  shortfallDays: number;
  noticeBasis: DailyRateBasis;
  recoveries: { id: string; title: string; amount: number }[];
  adjustments: { label: string; kind: 'EARNING' | 'DEDUCTION'; amount: number }[];
}

export interface StatementLine {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
  detail: string | null;
}

const BASIS_LABEL: Record<DailyRateBasis, string> = { BASIC_26: 'Basic ÷ 26', BASIC_30: 'Basic ÷ 30', GROSS_30: 'gross ÷ 30' };
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Full & final statement for what the regular payroll does not pay: leave encashment, gratuity, notice pay (paid in
 * lieu by the employer or recovered from a resigning employee), clearance recoveries and manual adjustments.
 */
export function settlementLines(input: SettlementInput): { lines: StatementLine[]; totalEarnings: number; totalDeductions: number; net: number } {
  const lines: StatementLine[] = [];
  const leaveRate = dailyRate(input.encashmentBasis, input.monthlyBasic, input.monthlyGross);
  for (const l of input.encashment) {
    if (l.days <= 0) continue;
    lines.push({ code: `LEAVE_${l.code}`, label: `Leave encashment – ${l.name}`, kind: 'EARNING', amount: Math.round(l.days * leaveRate), detail: `${l.days} days × ${money(Math.round(leaveRate * 100) / 100)} (${BASIS_LABEL[input.encashmentBasis]})` });
  }
  if (input.gratuity?.include && input.gratuity.years > 0) {
    const amount = gratuityAmount(input.monthlyBasic, input.gratuity.years);
    lines.push({ code: 'GRATUITY', label: 'Gratuity', kind: 'EARNING', amount, detail: `15/26 × ${money(input.monthlyBasic)} Basic × ${input.gratuity.years} year${input.gratuity.years === 1 ? '' : 's'}${amount === GRATUITY_CAP ? ' (capped at ₹20 lakh)' : ''}` });
  }
  if (input.shortfallDays > 0) {
    const rate = dailyRate(input.noticeBasis, input.monthlyBasic, input.monthlyGross);
    const amount = Math.round(input.shortfallDays * rate);
    const detail = `${input.shortfallDays} days of notice not served × ${money(Math.round(rate * 100) / 100)} (${BASIS_LABEL[input.noticeBasis]})`;
    if (EMPLOYER_INITIATED_EXITS.includes(input.type)) lines.push({ code: 'NOTICE_PAY', label: 'Notice pay in lieu', kind: 'EARNING', amount, detail });
    else if (input.type === 'RESIGNATION') lines.push({ code: 'NOTICE_RECOVERY', label: 'Notice period recovery', kind: 'DEDUCTION', amount, detail });
  }
  for (const r of input.recoveries) {
    if (r.amount > 0) lines.push({ code: `CLEARANCE_${r.id.slice(0, 8)}`, label: `Recovery – ${r.title}`, kind: 'DEDUCTION', amount: Math.round(r.amount), detail: 'From exit clearance' });
  }
  input.adjustments.forEach((a, i) => {
    if (a.amount > 0) lines.push({ code: `ADJ_${i + 1}`, label: a.label, kind: a.kind, amount: Math.round(a.amount * 100) / 100, detail: null });
  });
  const totalEarnings = lines.filter((l) => l.kind === 'EARNING').reduce((s, l) => s + l.amount, 0);
  const totalDeductions = lines.filter((l) => l.kind === 'DEDUCTION').reduce((s, l) => s + l.amount, 0);
  return { lines, totalEarnings, totalDeductions, net: Math.round((totalEarnings - totalDeductions) * 100) / 100 };
}
