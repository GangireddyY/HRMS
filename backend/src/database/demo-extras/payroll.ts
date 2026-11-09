import { addDays, addMonths, monthRange } from '../../common/utils/zoned-time';
import { PDF, type As, type Json, type Kit } from './kit';

const PAYROLL = 'payroll@acme.test';
const FINANCE = 'finance@acme.test';
const ASHA = 'employee@acme.test';
const KARTHIK = 'karthik@acme.test';
const DIVYA = 'divya@acme.test';

const ym = (d: string) => ({ year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) });
const monthIndex = (d: string) => ym(d).year * 12 + ym(d).month - 1;
/** A moment on a date, India time. */
const ist = (date: string, time: string) => `${date}T${time}:00+05:30`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodLabel = (d: string) => `${MONTHS[ym(d).month - 1]} ${ym(d).year}`;

async function runOf(as: As, month: string): Promise<Json | undefined> {
  const { year, month: m } = ym(month);
  const runs = (await as.get(`/payroll/runs?year=${year}&pageSize=100`)) as Json[];
  return runs.find((r) => r.month === m && r.status !== 'CANCELLED');
}

async function claimOf(as: As, title: string): Promise<Json | undefined> {
  const claims = (await as.get(`/payroll/reimbursements?view=mine&pageSize=100&search=${encodeURIComponent(title)}`)) as Json[];
  return claims.find((c) => c.title === title);
}

function claim(as: As, c: { category: string; title: string; amount: number; expenseDate: string; description?: string }): Promise<Json> {
  const fields: Record<string, string> = { category: c.category, title: c.title, amount: String(c.amount), expenseDate: c.expenseDate };
  if (c.description) fields.description = c.description;
  return as.upload('/payroll/reimbursements', fields, { data: PDF, name: 'receipt.pdf', type: 'application/pdf' });
}

/** Moves a claim (and the notifications it sent) back in time. */
async function backdateClaim(kit: Kit, c: Json, submitted: string, reviewed?: string) {
  await kit.sql(`UPDATE reimbursement_claims SET created_at = :submitted${reviewed ? ', reviewed_at = :reviewed' : ''} WHERE id = :id AND organization_id = :orgId`, { id: c.id, submitted, reviewed });
  await kit.sql(`UPDATE notifications SET created_at = :submitted WHERE organization_id = :orgId AND type = 'payroll.claim' AND body = :title`, { submitted, title: c.title });
  if (reviewed) await kit.sql(`UPDATE notifications SET created_at = :reviewed WHERE organization_id = :orgId AND type = 'payroll.claim' AND title LIKE :quoted`, { reviewed, quoted: `%"${c.title}"%` });
}

/** Payroll, salaries, loans and reimbursements scenarios. */
export async function seedPayrollExtras(kit: Kit): Promise<void> {
  const thisMonth = `${kit.today.slice(0, 7)}-01`;
  const nextMonth = addMonths(thisMonth, 1);
  const history = [addMonths(thisMonth, -3), addMonths(thisMonth, -2)];

  // Before the history: paid with the second of those runs.
  await kit.step(`Asha's flight claim paid with ${periodLabel(history[1]!)} payroll`, () => paidTravelClaim(kit, history[1]!));
  await kit.step(`Paid payroll for ${history.map(periodLabel).join(' and ')}`, () => payrollHistory(kit, history));
  // Before this month's run is submitted: repayments can't be recorded while a run waits for approval.
  await kit.step("Divya's salary advance: first instalment repaid", () => advanceRepayment(kit));
  await kit.step(`Asha's 12% raise from ${nextMonth}`, () => upcomingRaise(kit, nextMonth));
  await kit.step("Karthik's salary last financial year", () => earlierSalary(kit));
  await kit.step(`${periodLabel(thisMonth)} payroll awaiting approval`, () => runAwaitingApproval(kit, thisMonth));
  // After this month's run is submitted, so the approved claim waits for the next payroll.
  await kit.step("Asha's broadband claim approved for the next payroll", () => approvedBroadbandClaim(kit, thisMonth));
  await kit.step("Asha's team dinner claim rejected", () => rejectedDinnerClaim(kit));
  await kit.step("Karthik's hotel claim waiting over a week", () => staleHotelClaim(kit));
}

async function paidTravelClaim(kit: Kit, month: string) {
  const title = 'Flight to Hyderabad for the partner workshop';
  const asha = await kit.as(ASHA);
  if (await claimOf(asha, title)) return 'skipped';
  const expenseDate = addDays(month, 9);
  const c = await claim(asha, { category: 'TRAVEL', title, amount: 7850, expenseDate, description: 'IndiGo Bengaluru–Hyderabad return; booked two days ahead' });
  await (await kit.as(PAYROLL)).post(`/payroll/reimbursements/${c.id}/approve`, { note: 'Fare matches the e-ticket' });
  await backdateClaim(kit, c, ist(addDays(expenseDate, 2), '18:40'), ist(addDays(expenseDate, 4), '11:15'));
}

/**
 * Paid runs for months before the latest processed one. The API only runs payroll after the last approved month,
 * so the later approved / paid runs are hidden (status CANCELLED) while these are processed, then restored.
 */
async function payrollHistory(kit: Kit, months: string[]) {
  // A previous attempt that stopped half-way: paid runs can't be cancelled through the API, so these were hidden here.
  await kit.sql(`UPDATE payroll_runs SET status = 'PAID' WHERE organization_id = :orgId AND status = 'CANCELLED' AND paid_at IS NOT NULL`);
  const payroll = await kit.as(PAYROLL);
  const finance = await kit.as(FINANCE);
  const todo: string[] = [];
  for (const m of months) {
    const run = await runOf(payroll, m);
    if (!run) todo.push(m);
    else if (run.status !== 'PAID' && run.status !== 'APPROVED') throw new Error(`${run.period} payroll is ${String(run.status).toLowerCase()}; finish or cancel it first`);
  }
  if (!todo.length) return 'skipped';
  const open = await kit.sql<{ year: number; month: number }>(`SELECT year, month FROM payroll_runs WHERE organization_id = :orgId AND status IN ('DRAFT', 'SUBMITTED')`);
  if (open.length) throw new Error(`Payroll for ${open[0]!.month}/${open[0]!.year} is in progress; history can only be added before it`);

  const later = await kit.sql<{ id: string; status: string }>(`SELECT id, status FROM payroll_runs WHERE organization_id = :orgId AND status IN ('APPROVED', 'PAID') AND year * 12 + month - 1 > :first`, {
    first: monthIndex(todo[0]!),
  });
  if (later.length) await kit.sql(`UPDATE payroll_runs SET status = 'CANCELLED' WHERE id IN (:ids) AND organization_id = :orgId`, { ids: later.map((r) => r.id) });
  try {
    for (const m of todo) {
      const { year, month } = ym(m);
      const last = monthRange(year, month).to;
      const run = await payroll.post('/payroll/runs', { year, month });
      await payroll.post(`/payroll/runs/${run.id}/submit`);
      await finance.post(`/payroll/runs/${run.id}/approve`, { note: 'Variance checked against last month' });
      await finance.post(`/payroll/runs/${run.id}/pay`, { paymentReference: `NEFT-${last.replace(/-/g, '')}` });
      const at = { submitted: ist(addDays(m, 24), '16:30'), reviewed: ist(addDays(m, 26), '11:00'), paid: ist(last, '10:30') };
      await kit.sql(`UPDATE payroll_runs SET created_at = :created, calculated_at = :submitted, submitted_at = :submitted, reviewed_at = :reviewed, paid_at = :paid WHERE id = :id AND organization_id = :orgId`, {
        id: run.id,
        created: ist(addDays(m, 24), '10:05'),
        ...at,
      });
      await kit.sql(`UPDATE notifications SET created_at = :reviewed, read_at = :reviewed WHERE organization_id = :orgId AND type IN ('payroll.run', 'payroll.payslip') AND title LIKE :period`, {
        reviewed: at.reviewed,
        period: `%${periodLabel(m)}%`,
      });
      kit.log(`${periodLabel(m)}: ${run.employeeCount} employees, net ₹${Number(run.totalNet).toLocaleString('en-IN')}`);
    }
  } finally {
    for (const r of later) await kit.sql(`UPDATE payroll_runs SET status = :status WHERE id = :id AND organization_id = :orgId`, r);
  }
}

async function advanceRepayment(kit: Kit) {
  const payroll = await kit.as(PAYROLL);
  const divya = await kit.person(DIVYA);
  const advances = (await payroll.get('/payroll/loans?type=ADVANCE&pageSize=100')) as Json[];
  const advance = advances.find((l) => l.employee?.id === divya.employeeId && (l.status === 'ACTIVE' || l.status === 'CLOSED'));
  if (!advance) throw new Error("Divya's disbursed salary advance is missing (run npm run db:seed:demo first)");
  if (advance.repaid > 0) return 'skipped';
  await payroll.post(`/payroll/loans/${advance.id}/repayments`, { amount: advance.emi, paidOn: kit.today, note: 'First instalment paid early by UPI (UTR 431298765012)' });
}

async function upcomingRaise(kit: Kit, effectiveFrom: string) {
  const payroll = await kit.as(PAYROLL);
  const asha = await kit.person(ASHA);
  const { salaries } = (await payroll.get(`/payroll/employees/${asha.employeeId}/salaries`)) as { salaries: Json[] };
  if (salaries.some((s) => s.effectiveFrom > kit.today)) return 'skipped';
  const current = salaries.find((s) => s.effectiveFrom <= kit.today);
  if (!current) throw new Error('Asha has no current salary');
  await payroll.post(`/payroll/employees/${asha.employeeId}/salaries`, {
    structureId: current.structure.id,
    annualCtc: Math.round((current.annualCtc * 1.12) / 1000) * 1000,
    pfApplicable: current.pfApplicable,
    effectiveFrom,
    reason: 'Mid-year revision for leading the payments API v2 migration',
  });
}

/**
 * A lower salary in the previous financial year. Salaries can't start in months payroll has processed, so it is set
 * from a future date and then moved back.
 */
async function earlierSalary(kit: Kit) {
  const payroll = await kit.as(PAYROLL);
  const karthik = await kit.person(KARTHIK);
  const { year, month } = ym(kit.today);
  const fyStart = `${month >= 4 ? year : year - 1}-04-01`;
  const from = addMonths(fyStart, -12);
  const { salaries } = (await payroll.get(`/payroll/employees/${karthik.employeeId}/salaries`)) as { salaries: Json[] };
  if (salaries.some((s) => s.effectiveFrom < fyStart)) return 'skipped';
  const current = salaries.find((s) => s.effectiveFrom <= kit.today);
  if (!current) throw new Error('Karthik has no current salary');
  const temporary = addDays(addMonths(`${kit.today.slice(0, 7)}-01`, 4), 14);
  const s = await payroll.post(`/payroll/employees/${karthik.employeeId}/salaries`, {
    structureId: current.structure.id,
    annualCtc: Math.round(current.annualCtc / 1.12 / 1000) * 1000,
    pfApplicable: current.pfApplicable,
    effectiveFrom: temporary,
    reason: 'Annual compensation',
  });
  const created = ist(addDays(from, -9), '12:10');
  await kit.sql(`UPDATE employee_salaries SET effective_from = :from, created_at = :created WHERE id = :id AND organization_id = :orgId`, { id: s.id, from, created });
  await kit.sql(`UPDATE notifications SET title = :title, created_at = :created, read_at = :created WHERE organization_id = :orgId AND user_id = :userId AND type = 'payroll.salary' AND title = :temporaryTitle`, {
    userId: karthik.userId,
    created,
    title: `Your salary has been updated (effective ${from})`,
    temporaryTitle: `Your salary has been updated (effective ${temporary})`,
  });
}

async function runAwaitingApproval(kit: Kit, month: string) {
  const payroll = await kit.as(PAYROLL);
  const existing = await runOf(payroll, month);
  if (existing && existing.status !== 'DRAFT') return 'skipped';
  const { year, month: m } = ym(month);
  const run = existing ?? (await payroll.post('/payroll/runs', { year, month: m }));
  const submitted = await payroll.post(`/payroll/runs/${run.id}/submit`);
  kit.log(`${submitted.period}: ${submitted.employeeCount} employees, net ₹${Number(submitted.totalNet).toLocaleString('en-IN')}, waiting for Anita Desai`);
}

async function approvedBroadbandClaim(kit: Kit, thisMonth: string) {
  const title = 'Home broadband (ACT Fibernet)';
  const asha = await kit.as(ASHA);
  if (await claimOf(asha, title)) return 'skipped';
  const c = await claim(asha, { category: 'INTERNET_PHONE', title, amount: 1179, expenseDate: addDays(thisMonth, -1), description: `${periodLabel(addMonths(thisMonth, -1))} bill, 300 Mbps plan for work from home` });
  await backdateClaim(kit, c, ist(kit.day(-2), '21:10'));
  await (await kit.as(PAYROLL)).post(`/payroll/reimbursements/${c.id}/approve`, { note: 'Within the ₹1,500 monthly internet allowance' });
}

async function rejectedDinnerClaim(kit: Kit) {
  const title = 'Team dinner after the payments release';
  const asha = await kit.as(ASHA);
  if (await claimOf(asha, title)) return 'skipped';
  const c = await claim(asha, { category: 'FOOD', title, amount: 4850, expenseDate: kit.day(-6), description: 'Dinner for six at Truffles, Koramangala' });
  await (await kit.as(PAYROLL)).post(`/payroll/reimbursements/${c.id}/reject`, {
    note: 'Team celebrations are paid from the engineering team-events budget, not reimbursements. Please ask Priya to raise it with Finance.',
  });
  await backdateClaim(kit, c, ist(kit.day(-5), '20:35'), ist(kit.day(-3), '11:40'));
}

async function staleHotelClaim(kit: Kit) {
  const title = 'Hotel stay for the Hyderabad client workshop';
  const karthik = await kit.as(KARTHIK);
  if (await claimOf(karthik, title)) return 'skipped';
  const c = await claim(karthik, { category: 'TRAVEL', title, amount: 6400, expenseDate: kit.day(-11), description: 'Two nights at Lemon Tree, HITEC City' });
  await backdateClaim(kit, c, ist(kit.day(-9), '19:20'));
}
