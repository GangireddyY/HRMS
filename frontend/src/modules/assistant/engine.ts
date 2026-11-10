import type { useAuthStore } from '@/core/auth/auth.store';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import { canApproveAnything, daysUntil, loadAbsences, loadApprovals, localToday } from '@/modules/insights/approvals';
import { leaveApi } from '@/modules/leave/api/leave.api';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { employeesApi } from '@/modules/people/api/people.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import { reportsApi } from '@/modules/reports/api/reports.api';
import { formatDate, formatMoney } from '@/shared/utils/format';

/**
 * The HRMS assistant: understands common questions and requests in plain language (by recognising intents from
 * keywords, not a language model) and answers them from live data through the same APIs and permissions as the
 * screens, with links to act. What it can't answer, it says so and points to the closest pages.
 */
type Auth = ReturnType<typeof useAuthStore>;

export interface Page {
  label: string;
  hint: string;
  to: string;
}

export interface Reply {
  text: string;
  stats?: { label: string; value: string; hint?: string }[];
  items?: { id: string; label: string; meta?: string; to?: string; badge?: string }[];
  actions?: { label: string; to: string }[];
}

interface Context {
  auth: Auth;
  pages: Page[];
}

interface Intent {
  id: string;
  /** Example questions, shown as suggestions. */
  examples: string[];
  match: (q: string) => RegExpMatchArray | boolean | null;
  allowed: (c: Context) => boolean;
  run: (q: string, c: Context, m: RegExpMatchArray | boolean | null) => Promise<Reply>;
}

const hasPage = (c: Context, to: string) => c.pages.some((p) => p.to === to);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const range = (from: string, to: string) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);

/** Things people ask to do, matched to the page where they do it (shown only when that page is available to them). */
const ACTIONS: { words: RegExp; label: string; to: string }[] = [
  { words: /\b(apply|request|take|book)\b.*\b(leave|vacation|holiday|day off|time off)\b|\bleave application\b/, label: 'Apply for leave', to: '/me/leave' },
  { words: /\b(wfh|work from home|remote)\b/, label: 'Request work from home', to: '/me/attendance' },
  { words: /\b(claim|reimburse|expense)/, label: 'Claim an expense', to: '/me/reimbursements' },
  { words: /\b(loan|advance)\b/, label: 'Request a loan or advance', to: '/me/loans' },
  { words: /\b(laptop|monitor|asset|equipment|id card|access card)\b/, label: 'My assets', to: '/me/assets' },
  { words: /\b(travel|trip|flight|business trip)\b/, label: 'Request business travel', to: '/me/travel' },
  { words: /\b(helpdesk|ticket|ask hr|hr question|query)\b/, label: 'Ask HR (helpdesk)', to: '/me/helpdesk' },
  { words: /\b(regulari[sz]e|missed punch|forgot to punch|correct (my )?attendance)\b/, label: 'Correct attendance', to: '/me/attendance' },
  { words: /\b(resign|resignation|quit|notice period)\b/, label: 'Resignation & exit', to: '/me/exit' },
  { words: /\b(grievance|complaint|complain|harass)/, label: 'Raise a grievance', to: '/me/grievances' },
  { words: /\b(invite|add)\b.*\b(user|member)\b/, label: 'Invite a user', to: '/admin/users' },
  { words: /\b(add|create|new|onboard)\b.*\b(employee|joiner|hire)\b/, label: 'Add an employee', to: '/hr/employees/new' },
  { words: /\b(post|create|open|new)\b.*\b(job|opening|role|position)\b/, label: 'Post a job', to: '/hr/recruitment/jobs' },
  { words: /\b(add|new)\b.*\bcandidate\b/, label: 'Add a candidate', to: '/hr/recruitment/candidates' },
  { words: /\b(run|process|start)\b.*\bpayroll\b/, label: 'Run payroll', to: '/hr/payroll/runs' },
  { words: /\b(announce|announcement|broadcast)\b/, label: 'Post an announcement', to: '/hr/engagement/announcements' },
  { words: /\b(survey|pulse)\b/, label: 'Surveys', to: '/hr/engagement/surveys' },
  { words: /\b(review cycle|appraisal|performance review)\b/, label: 'Review cycles', to: '/hr/performance/cycles' },
  { words: /\b(org ?chart|reporting line|hierarchy)\b/, label: 'Org chart', to: '/hr/org-chart' },
  { words: /\b(2fa|two.factor|mfa|password|security)\b/, label: 'Security settings', to: '/me/security' },
  { words: /\b(photo|avatar|profile picture|my profile)\b/, label: 'My profile', to: '/me/profile' },
];

const INTENTS: Intent[] = [
  {
    id: 'approvals',
    examples: ['What needs my approval?'],
    match: (q) => /\b(approv\w*|pending|waiting|inbox|to.?do|action items?)\b/.test(q) && !/\bmy (leave|request|claim)/.test(q),
    allowed: (c) => canApproveAnything(c.auth),
    async run(_q, c) {
      const all = await loadApprovals(c.auth);
      const waiting = all.filter((a) => a.count > 0).sort((a, b) => b.count - a.count);
      const total = waiting.reduce((n, a) => n + a.count, 0);
      if (!total) return { text: "You're all caught up — nothing is waiting for your approval." };
      return { text: `${plural(total, 'item')} ${total === 1 ? 'is' : 'are'} waiting for your decision:`, items: waiting.map((a) => ({ id: a.key, label: a.label, badge: String(a.count), to: a.to })) };
    },
  },
  {
    id: 'balance',
    examples: ['How much leave do I have?'],
    match: (q) => /\b(leave|leaves|vacation|holidays?|days? off|time off|cl|el|sl)\b.*\b(balance|left|remaining|have|available|got)\b|\b(balance|left|remaining|how many)\b.*\b(leave|leaves|days? off|cl|el|sl)\b/.test(q),
    allowed: (c) => c.auth.can('leave.view') && c.auth.hasFeature('leave'),
    async run() {
      const b = await leaveApi.balances();
      const rows = b.balances.filter((x) => !x.leaveType.unlimited || x.taken > 0);
      return {
        text: `Your leave for ${b.range.from.slice(0, 4)}–${b.range.to.slice(2, 4)}:`,
        stats: rows.map((x) => ({ label: x.leaveType.name, value: x.leaveType.unlimited ? 'No limit' : `${x.available ?? 0}`, hint: x.leaveType.unlimited ? `${x.taken} taken` : `${x.taken} taken${x.pending ? ` · ${x.pending} pending` : ''}` })),
        actions: [{ label: 'Apply for leave', to: '/me/leave' }],
      };
    },
  },
  {
    id: 'myRequests',
    examples: ['Status of my leave requests'],
    match: (q) => /\b(my|status)\b.*\b(leave|leaves)\b.*\b(request|requests|application|status|approved)\b|\bmy leave requests?\b/.test(q),
    allowed: (c) => c.auth.can('leave.view') && c.auth.hasFeature('leave'),
    async run() {
      const page = await leaveApi.requests({ view: 'mine', page: 1, pageSize: 5 });
      if (!page.items.length) return { text: "You haven't applied for any leave yet.", actions: [{ label: 'Apply for leave', to: '/me/leave' }] };
      return { text: 'Your latest leave requests:', items: page.items.map((r) => ({ id: r.id, label: `${r.leaveType?.name ?? 'Leave'} · ${plural(r.days, 'day')}`, meta: range(r.startDate, r.endDate), badge: r.status.charAt(0) + r.status.slice(1).toLowerCase(), to: '/me/leave' })) };
    },
  },
  {
    id: 'whoIsOut',
    examples: ['Who is on leave this week?'],
    match: (q) => /\b(who|anyone|people|team)\b.*\b(out|on leave|off|absent|away|leave)\b|\bon leave (today|this week|tomorrow)\b/.test(q),
    allowed: (c) => c.auth.can('leave.view', 'TEAM') && c.auth.hasFeature('leave'),
    async run(q) {
      const todayOnly = /\btoday\b/.test(q);
      const list = await loadAbsences(todayOnly ? 1 : 7);
      const today = localToday();
      if (!list.length) return { text: todayOnly ? 'Nobody you can see is on approved leave today.' : 'Nobody you can see is on approved leave in the next 7 days.' };
      const outToday = list.filter((a) => a.startDate <= today && a.endDate >= today).length;
      return {
        text: todayOnly ? `${plural(list.length, 'person')} on leave today:` : `${plural(list.length, 'leave')} in the next 7 days${outToday ? ` (${outToday} out today)` : ''}:`,
        items: list.map((a) => ({ id: a.id, label: a.employee.name, meta: `${a.leaveType} · ${range(a.startDate, a.endDate)}${a.employee.department ? ` · ${a.employee.department}` : ''}` })),
        actions: [{ label: 'Team calendar', to: '/hr/leave/calendar' }],
      };
    },
  },
  {
    id: 'holidays',
    examples: ['When is the next holiday?'],
    match: (q) => /\b(holiday|holidays|public holiday|long weekend)\b/.test(q),
    allowed: (c) => c.auth.hasFeature('attendance'),
    async run() {
      const year = Number(localToday().slice(0, 4));
      const [a, b] = await Promise.all([attendanceApi.holidays(year), attendanceApi.holidays(year + 1)]);
      const upcoming = [...a, ...b].filter((h) => h.date >= localToday()).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 5);
      if (!upcoming.length) return { text: 'No upcoming holidays are on the calendar yet.' };
      const next = upcoming[0]!;
      const d = daysUntil(next.date);
      return {
        text: `The next holiday is ${next.name} on ${formatDate(next.date)}${d === 0 ? ' — today' : d === 1 ? ' — tomorrow' : `, in ${d} days`}.`,
        items: upcoming.map((h) => ({ id: h.id, label: h.name, meta: formatDate(h.date), badge: h.isOptional ? 'Optional' : undefined })),
      };
    },
  },
  {
    id: 'payslip',
    examples: ['Show my latest payslip'],
    match: (q) => /\b(payslip|pay slip|salary slip|net pay|take.?home|my salary|last salary|paid this month)\b/.test(q),
    allowed: (c) => c.auth.can('payroll.payslip.view') && c.auth.hasFeature('payroll'),
    async run() {
      const slips = await payrollApi.myPayslips();
      const latest = slips[0];
      if (!latest) return { text: 'No payslips have been published for you yet.' };
      return {
        text: `Your ${latest.period} payslip${latest.paidAt ? `, paid on ${formatDate(latest.paidAt)}` : ''}:`,
        stats: [
          { label: 'Gross', value: formatMoney(latest.gross) },
          { label: 'Deductions', value: formatMoney(latest.totalDeductions) },
          { label: 'Net pay', value: formatMoney(latest.netPay) },
        ],
        actions: [{ label: 'Open payslip', to: `/me/payslips/${latest.id}` }, { label: 'All payslips', to: '/me/payslips' }],
      };
    },
  },
  {
    id: 'attendance',
    examples: ['Did I punch in today?'],
    match: (q) => /\b(punch|punched|clock(ed)? in|check(ed)? in|attendance today|my attendance)\b/.test(q),
    allowed: (c) => c.auth.can('attendance.view') && c.auth.hasFeature('attendance'),
    async run() {
      const t = await attendanceApi.today();
      const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
      const r = t.openRecord ?? t.record;
      const text = t.holiday
        ? `Today is a holiday (${t.holiday.name}).`
        : r?.checkInAt
          ? `You punched in at ${time(r.checkInAt)}${r.checkOutAt ? ` and out at ${time(r.checkOutAt)}` : ' and are still punched in'}.`
          : t.isWeeklyOff
            ? "It's your weekly off today."
            : "You haven't punched in today.";
      return { text, actions: [{ label: 'My attendance', to: '/me/attendance' }] };
    },
  },
  {
    id: 'headcount',
    examples: ['What is our headcount?'],
    match: (q) => /\b(headcount|head count|how many (employees|people|staff)|team size|attrition|joiners|leavers)\b/.test(q),
    allowed: (c) => c.auth.can('reports.view', 'TEAM') && c.auth.hasFeature('reports'),
    async run() {
      const r = await reportsApi.run('headcount', {});
      const s = r.summary;
      return {
        text: `Headcount today: ${s.headcount ?? 0}.`,
        stats: [
          { label: 'Headcount', value: String(s.headcount ?? 0) },
          { label: 'Serving notice', value: String(s.onNotice ?? 0) },
          { label: 'Joined (30 days)', value: String(s.joinersLast30Days ?? 0) },
          { label: 'Women', value: s.womenShare === null || s.womenShare === undefined ? '—' : `${s.womenShare}%` },
        ],
        actions: [{ label: 'Headcount report', to: '/hr/reports/headcount' }, { label: 'Attrition report', to: '/hr/reports/attrition' }],
      };
    },
  },
  {
    id: 'jobs',
    examples: ['Which jobs are open?'],
    match: (q) => /\b(open (jobs|roles|positions|openings)|hiring|vacanc\w+|job openings?)\b/.test(q),
    allowed: (c) => c.auth.can('recruitment.view') && c.auth.hasFeature('recruitment'),
    async run() {
      const page = await recruitmentApi.jobs({ status: 'OPEN', page: 1, pageSize: 10 });
      if (!page.items.length) return { text: 'There are no open jobs right now.', actions: [{ label: 'Jobs', to: '/hr/recruitment/jobs' }] };
      return {
        text: `${plural(page.meta.total, 'open job')}:`,
        items: page.items.map((j) => {
          const applicants = Object.values(j.pipeline).reduce((n, x) => n + (x ?? 0), 0);
          return { id: j.id, label: j.title, meta: [j.requisition.department?.name, plural(applicants, 'applicant')].filter(Boolean).join(' · '), to: `/hr/recruitment/jobs/${j.id}` };
        }),
      };
    },
  },
  {
    id: 'policies',
    examples: ['Which policies do I need to acknowledge?'],
    match: (q) => /\b(polic(y|ies)|acknowledg\w*|code of conduct)\b/.test(q),
    allowed: (c) => c.auth.can('compliance.view') && c.auth.hasFeature('compliance'),
    async run() {
      const mine = await complianceApi.mine();
      const pending = mine.filter((p) => p.state === 'PENDING' || p.state === 'OVERDUE');
      if (!pending.length) return { text: `You're up to date — ${plural(mine.length, 'policy')} apply to you and none needs acknowledging.`, actions: [{ label: 'Policies', to: '/me/policies' }] };
      return { text: `${plural(pending.length, 'policy')} to read and acknowledge:`, items: pending.map((p) => ({ id: p.id, label: p.title, meta: p.dueOn ? `Due ${formatDate(p.dueOn)}` : undefined, badge: p.state === 'OVERDUE' ? 'Overdue' : undefined, to: `/me/policies/${p.id}` })) };
    },
  },
  {
    id: 'person',
    examples: ['Find Priya'],
    match: (q) => q.match(/^(?:who is|who's|find|look ?up|search(?: for)?|show me|contact(?: details)? (?:of|for)|phone (?:number )?of|email of)\s+(.{2,60}?)\??$/),
    allowed: (c) => c.auth.can('employee.view', 'TEAM') && c.auth.hasFeature('employee'),
    async run(_q, _c, m) {
      const name = (m as RegExpMatchArray)[1]!.replace(/['’]s\b.*$/, '').trim();
      const page = await employeesApi.list({ search: name, page: 1, pageSize: 6 });
      if (!page.items.length) return { text: `I couldn't find anyone matching “${name}”.`, actions: [{ label: 'All employees', to: '/hr/employees' }] };
      return {
        text: page.items.length === 1 ? 'Here they are:' : `People matching “${name}”:`,
        items: page.items.map((e) => ({ id: e.id, label: e.fullName, meta: [e.designation?.name, e.department?.name, e.workEmail].filter(Boolean).join(' · '), to: `/hr/employees/${e.id}` })),
      };
    },
  },
];

/** Example questions this user can ask (respecting their permissions and modules). */
export function suggestions(c: Context): string[] {
  const fromIntents = INTENTS.filter((i) => i.allowed(c)).flatMap((i) => i.examples);
  const actions = ACTIONS.filter((a) => hasPage(c, a.to)).map((a) => a.label);
  return [...fromIntents, ...actions.slice(0, 2)].slice(0, 8);
}

export async function answer(question: string, c: Context): Promise<Reply> {
  const q = question.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return { text: 'Ask me something about your HR data, or what you want to do.' };
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(q)) {
    return { text: `Hi ${c.auth.user?.firstName ?? 'there'}! I can answer questions from your HR data and take you to the right place. Try one of these:`, actions: [] };
  }
  if (/^(help|\?|what can you do)/.test(q)) {
    return { text: 'I can look things up in your live HR data and help you get things done. For example:', items: suggestions(c).map((s, i) => ({ id: String(i), label: s })) };
  }
  for (const intent of INTENTS) {
    const m = intent.match(q);
    if (!m) continue;
    if (!intent.allowed(c)) return { text: "That isn't available with your current role or your organization's plan." };
    try {
      return await intent.run(q, c, m);
    } catch {
      return { text: "I couldn't fetch that just now. Please try again in a moment." };
    }
  }
  const action = ACTIONS.find((a) => a.words.test(q) && hasPage(c, a.to));
  if (action) return { text: `Sure — you can do that here:`, actions: [{ label: action.label, to: action.to }] };

  // Fall back to the pages whose names share words with the question.
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'how', 'what', 'where', 'show', 'with', 'can', 'my', 'our'].includes(w));
  const pages = c.pages.filter((p) => words.some((w) => p.label.toLowerCase().includes(w))).slice(0, 4);
  if (pages.length) return { text: "I can't answer that directly, but these pages look related:", actions: pages.map((p) => ({ label: `${p.label} · ${p.hint}`, to: p.to })) };
  return { text: "Sorry, I don't know how to help with that yet. Here's what I can do:", items: suggestions(c).map((s, i) => ({ id: String(i), label: s })) };
}
