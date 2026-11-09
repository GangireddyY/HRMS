import { addDays, addMonths } from '../../common/utils/zoned-time';
import { leaveYearOf } from '../../modules/leave/leave-policy';
import type { Json, Kit } from './kit';
import { pdfFile } from './people-files';

const HR = 'hr.manager@acme.test';
const TEAM_LEAD = 'team.lead@acme.test';
const ASHA = 'employee@acme.test';

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isWorkday = (d: string) => weekday(d) !== 0 && weekday(d) !== 6;
/** The first working day on or after `d`. */
function workdayFrom(d: string): string {
  while (!isWorkday(d)) d = addDays(d, 1);
  return d;
}
/** A moment on a date in the organization's time zone (India, UTC+5:30). */
const at = (date: string, time = '10:00') => `${date}T${time}:00+05:30`;
const pdf = async (name: string, title: string, lines: string[]) => ({ data: await pdfFile(title, lines), name, type: 'application/pdf' });

/** People, documents, probation, onboarding, leave, attendance, training, performance and benefits scenarios. */
export async function seedPeopleExtras(kit: Kit): Promise<void> {
  await kit.step('People: documents expired, expiring this week, this month and later', () => expiringDocuments(kit));
  await kit.step('People: probation ending soon, overdue, and a confirmation awaiting HR', () => probation(kit));
  await kit.step('Onboarding: a completed onboarding (Pooja, when she joined)', () => completedOnboarding(kit));
  await kit.step('Leave: Divya and Pooja away on the days of Asha’s pending leave', () => overlappingLeave(kit));
  await kit.step('Leave: Asha’s approved leave last month', () => ashaLeaveLastMonth(kit));
  await kit.step('Training: Pooja’s mandatory security course overdue', () => overdueTraining(kit));
  await kit.step('Training: certificates expiring soon (Karthik) and expired (Farhan)', () => certificates(kit));
  await kit.step('Training: an upcoming live virtual session', () => virtualSession(kit));
  await kit.step('Performance: two check-ins on Sneha’s improvement plan', () => pipCheckIns(kit));
  await kit.step('Performance: Pooja’s goals waiting for approval', () => poojaGoals(kit));
  await kit.step('Performance: 360 feedback on Asha’s review (one answered, one pending)', () => peerFeedback(kit));
  await kit.step('Benefits: a life-event enrolment waiting for HR approval (Farhan)', () => pendingBenefit(kit));
  await kit.step('Recruitment: resumes for Sanjay, Ravi and Lata', () => resumes(kit));
}

// ---- Documents ------------------------------------------------------------------------------------------------------

const DOCUMENTS = [
  { email: 'karthik@acme.test', category: 'OTHER', title: 'Work permit (Singapore)', expiresIn: -5, file: 'work-permit.pdf', lines: ['Employment Pass — Ministry of Manpower, Singapore', 'Holder: Karthik Reddy', 'Pass type: Employment Pass (client deputation)'] },
  { email: 'manoj@acme.test', category: 'IDENTITY', title: 'Client site ID card', expiresIn: 6, file: 'client-site-id.pdf', lines: ['Contractor identity card — Whitefield data centre', 'Holder: Manoj Verma', 'Access: Operations floor, loading bay'] },
  { email: ASHA, category: 'IDENTITY', title: 'Passport', expiresIn: 20, file: 'passport.pdf', lines: ['Republic of India — Passport', 'Holder: Asha Patel', 'Passport no. Z1234567'] },
  { email: 'divya@acme.test', category: 'IDENTITY', title: 'Driving licence', expiresIn: 60, file: 'driving-licence.pdf', lines: ['Driving licence — Karnataka Transport Department', 'Holder: Divya Menon', 'Classes: LMV, MCWG'] },
] as const;

/** Verified documents with expiry dates (HR uploads are verified on upload), one per urgency bucket. */
async function expiringDocuments(kit: Kit) {
  const hr = await kit.as(HR);
  let created = 0;
  for (const d of DOCUMENTS) {
    const p = await kit.person(d.email);
    const existing = (await hr.get(`/employees/${p.employeeId}/documents`)) as { title: string }[];
    if (existing.some((x) => x.title === d.title)) continue;
    const expiryDate = kit.day(d.expiresIn);
    await hr.upload(`/employees/${p.employeeId}/documents`, { category: d.category, title: d.title, expiryDate }, await pdf(d.file, d.title, [...d.lines, `Valid until ${expiryDate}`]));
    kit.log(`${p.name}: ${d.title}, expires ${expiryDate}`);
    created++;
  }
  return created ? undefined : 'skipped';
}

// ---- Probation ------------------------------------------------------------------------------------------------------

/** Ishaan's probation ends soon, Pooja's ended without a recommendation, Divya's manager recommends confirming her. */
async function probation(kit: Kit) {
  const hr = await kit.as(HR);
  let changed = false;
  for (const [email, endsIn] of [['intern@acme.test', 10], ['pooja@acme.test', -3], ['divya@acme.test', 25]] as const) {
    const p = await kit.person(email);
    const e = (await hr.get(`/employees/${p.employeeId}`)) as Json;
    if (e.confirmedOn || e.probationEndDate) continue;
    await hr.patch(`/employees/${p.employeeId}`, { probationEndDate: kit.day(endsIn) });
    kit.log(`${p.name}: probation ends ${kit.day(endsIn)}`);
    changed = true;
  }
  const lead = await kit.as(TEAM_LEAD);
  const divya = await kit.person('divya@acme.test');
  const submitted = (await lead.get('/onboarding/probation/reviews?view=mine&pageSize=100')) as { employee: { id: string } | null; status: string }[];
  if (!submitted.some((r) => r.employee?.id === divya.employeeId && r.status !== 'CANCELLED')) {
    await lead.post('/onboarding/probation/reviews', {
      employeeId: divya.employeeId,
      recommendation: 'CONFIRM',
      comments: 'Divya owns the refunds API end to end, reviews carefully and needs little supervision. Ready to confirm.',
    });
    kit.log('Priya Nair recommends confirming Divya; waiting for HR');
    changed = true;
  }
  return changed ? undefined : 'skipped';
}

// ---- Onboarding -----------------------------------------------------------------------------------------------------

/** Pooja's onboarding run through the real checklist (her uploads verified by HR), then dated back to when she joined. */
async function completedOnboarding(kit: Kit) {
  const hr = await kit.as(HR);
  const pooja = await kit.person('pooja@acme.test');
  const casesIn = async (status: string) => (await hr.get(`/onboarding/cases?status=${status}&pageSize=100`)) as { id: string; status: string; employee: { id: string } }[];
  const existing = [...(await casesIn('COMPLETED')), ...(await casesIn('IN_PROGRESS'))].find((c) => c.employee.id === pooja.employeeId);
  if (existing?.status === 'COMPLETED') return 'skipped';

  const since = new Date(Date.now() - 60_000);
  const asha = await kit.person(ASHA);
  const caseId = existing?.id ?? ((await hr.post('/onboarding/cases', { employeeId: pooja.employeeId, buddyId: asha.employeeId, notes: 'Campus hire for the payments team' })) as Json).id;
  const detail = (await hr.get(`/onboarding/cases/${caseId}`)) as { tasks: { id: string; title: string; assignee: string; documentCategory: string | null; isRequired: boolean; state: string }[] };
  const self = await kit.as('pooja@acme.test');
  const lead = await kit.as(TEAM_LEAD);
  for (const t of detail.tasks) {
    if (t.state === 'DONE' || t.state === 'SKIPPED') continue;
    if (t.documentCategory) {
      if (!t.isRequired) {
        await hr.post(`/onboarding/tasks/${t.id}/skip`, { note: 'First job after campus, no previous employer' });
        continue;
      }
      const title = t.title.replace(/^Upload\s+/i, '');
      if (t.state !== 'SUBMITTED') await self.upload(`/onboarding/tasks/${t.id}/document`, {}, await pdf(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`, title, ['Holder: Pooja Bhat', 'Self-attested copy']));
      await hr.post(`/onboarding/tasks/${t.id}/verify`, { status: 'VERIFIED' });
    } else if (t.assignee === 'EMPLOYEE') await self.post(`/onboarding/tasks/${t.id}/complete`, {});
    else if (t.assignee === 'MANAGER') await lead.post(`/onboarding/tasks/${t.id}/complete`, {});
    else await hr.post(`/onboarding/tasks/${t.id}/complete`, {});
  }
  await hr.post(`/onboarding/cases/${caseId}/complete`);

  const joined = ((await hr.get(`/employees/${pooja.employeeId}`)) as Json).dateOfJoining as string;
  const started = at(addDays(joined, -10), '11:00');
  const finished = at(addDays(joined, 30), '17:30');
  await kit.sql(`UPDATE onboarding_cases SET created_at = :started, updated_at = :finished, completed_at = :finished WHERE id = :caseId`, { caseId, started, finished });
  await kit.sql(
    `UPDATE onboarding_tasks SET created_at = :started, updated_at = :finished,
            completed_at = CASE WHEN completed_at IS NULL THEN NULL ELSE (LEAST(due_date, CAST(:doneBy AS date)) + interval '16 hours') AT TIME ZONE 'Asia/Kolkata' END
      WHERE case_id = :caseId`,
    { caseId, started, finished, doneBy: addDays(joined, 30) },
  );
  await kit.sql(
    `UPDATE employee_documents d SET created_at = (t.due_date + interval '12 hours') AT TIME ZONE 'Asia/Kolkata', reviewed_at = (t.due_date + interval '16 hours') AT TIME ZONE 'Asia/Kolkata', updated_at = (t.due_date + interval '16 hours') AT TIME ZONE 'Asia/Kolkata'
       FROM onboarding_tasks t WHERE t.case_id = :caseId AND t.document_id = d.id`,
    { caseId },
  );
  await backdateNotifications(kit, since, finished, `n.link IN ('/me/onboarding', :caseLink, '/me/employment?tab=documents') AND (u.id = :poojaUser OR n.title LIKE '%Pooja Bhat%')`, {
    caseLink: `/hr/onboarding/${caseId}`,
    poojaUser: pooja.userId,
  });
  kit.log(`Pooja Bhat: onboarding completed ${addDays(joined, 30)}`);
  return undefined;
}

/** Notifications a backdated scenario just sent: moved to when it happened and marked read by their recipients. */
async function backdateNotifications(kit: Kit, since: Date, when: string, filter: string, replacements: Record<string, unknown>) {
  const rows = await kit.sql<{ id: string; email: string }>(
    `SELECT n.id, u.email FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.organization_id = :orgId AND n.created_at >= :since AND ${filter}`,
    { since, ...replacements },
  );
  if (!rows.length) return;
  await kit.sql(`UPDATE notifications SET created_at = :when WHERE id IN (:ids)`, { when, ids: rows.map((r) => r.id) });
  for (const r of rows) {
    const as = await kit.as(r.email).catch(() => null);
    await as?.post(`/notifications/${r.id}/read`);
  }
}

// ---- Leave ----------------------------------------------------------------------------------------------------------

type LeaveRow = { id: string; startDate: string; endDate: string; status: string; reason: string; leaveYear: number; leaveType: { id: string; code: string } | null };

async function leaveTypeId(kit: Kit, code: string): Promise<string> {
  const types = (await (await kit.as(HR)).get('/leave/types')) as { id: string; code: string }[];
  const type = types.find((t) => t.code === code);
  if (!type) throw new Error(`Leave type ${code} not found`);
  return type.id;
}

const live = (r: LeaveRow) => r.status === 'PENDING' || r.status === 'APPROVED';

/** Pending casual leave for Divya and Pooja (same team as Asha) on the days of Asha's pending request: approvers see "Also away". */
async function overlappingLeave(kit: Kit) {
  const asha = await kit.as(ASHA);
  const pending = (await asha.get('/leave/requests?view=mine&status=PENDING&pageSize=100')) as LeaveRow[];
  const ashaCl = pending.find((r) => r.leaveType?.code === 'CL' && r.startDate > kit.today);
  const start = ashaCl?.startDate ?? workdayFrom(kit.day(14));
  const pStart = workdayFrom(addDays(start, 1));
  const cl = await leaveTypeId(kit, 'CL');
  const requests = [
    { email: 'divya@acme.test', startDate: start, endDate: start, reason: 'Parent–teacher meeting at my son’s school' },
    { email: 'pooja@acme.test', startDate: pStart, endDate: workdayFrom(addDays(pStart, 1)), reason: 'Moving to the new flat in HSR Layout' },
  ];
  let created = 0;
  for (const r of requests) {
    const me = await kit.as(r.email);
    const mine = (await me.get('/leave/requests?view=mine&pageSize=100')) as LeaveRow[];
    if (mine.some((x) => x.reason === r.reason && live(x))) continue;
    await me.post('/leave/requests', { leaveTypeId: cl, startDate: r.startDate, endDate: r.endDate, reason: r.reason });
    kit.log(`${r.email}: casual leave ${r.startDate}${r.endDate !== r.startDate ? ` – ${r.endDate}` : ''} (pending)`);
    created++;
  }
  return created ? undefined : 'skipped';
}

const ASHA_PAST_REASON = 'Navratri with family in Ahmedabad';
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Two days of casual leave last month (days without attendance), approved by Asha's manager. Casual leave can be
 * applied for only a few days after the fact, so the admin lifts that limit for this one request and restores it.
 */
async function ashaLeaveLastMonth(kit: Kit) {
  const asha = await kit.as(ASHA);
  const mine = (await asha.get('/leave/requests?view=mine&pageSize=100')) as LeaveRow[];
  if (mine.some((r) => r.reason === ASHA_PAST_REASON && live(r))) return 'skipped';

  const ashaPerson = await kit.person(ASHA);
  const startMonth = Number(((await asha.get('/leave/settings')) as Json | null)?.leaveYearStartMonth ?? 4);
  const holidays = new Set((await kit.sql<{ d: string }>(`SELECT date::text AS d FROM holidays WHERE organization_id = :orgId`)).map((h) => h.d));
  const worked = new Set((await kit.sql<{ d: string }>(`SELECT work_date::text AS d FROM attendance_records WHERE employee_id = :id`, { id: ashaPerson.employeeId })).map((h) => h.d));
  const busy = mine.filter(live);
  const free = (d: string) =>
    weekday(d) >= 1 && weekday(d) <= 5 && !holidays.has(d) && !worked.has(d) && leaveYearOf(d, startMonth) === leaveYearOf(kit.today, startMonth) && !busy.some((r) => r.startDate <= d && r.endDate >= d);
  let target: string | null = null;
  for (let d = addMonths(`${kit.today.slice(0, 7)}-12`, -1); d < kit.day(-7) && !target; d = addDays(d, 1)) {
    if (weekday(d) <= 4 && free(d) && free(addDays(d, 1))) target = d;
  }
  if (!target) throw new Error('No two free working days found last month for Asha');
  const end = addDays(target, 1);

  const admin = await kit.as('admin@acme.test');
  const cl = ((await admin.get('/leave/types')) as { id: string; code: string; maxBackdatedDays: number }[]).find((t) => t.code === 'CL');
  if (!cl) throw new Error('Leave type CL not found');
  const needed = daysBetween(target, kit.today);
  const lift = cl.maxBackdatedDays < needed;
  let request: LeaveRow;
  if (lift) await admin.patch(`/leave/types/${cl.id}`, { maxBackdatedDays: needed });
  try {
    request = (await asha.post('/leave/requests', { leaveTypeId: cl.id, startDate: target, endDate: end, reason: ASHA_PAST_REASON })) as LeaveRow;
  } finally {
    if (lift) await admin.patch(`/leave/types/${cl.id}`, { maxBackdatedDays: cl.maxBackdatedDays });
  }
  await (await kit.as(TEAM_LEAD)).post(`/leave/requests/${request.id}/approve`, { note: 'Approved — enjoy the festival!' });
  await kit.sql(`UPDATE leave_requests SET created_at = :requested, reviewed_at = :approved, updated_at = :approved WHERE id = :id`, {
    id: request.id,
    requested: at(addDays(target, -12), '09:40'),
    approved: at(addDays(target, -11), '11:15'),
  });
  kit.log(`Asha Patel: casual leave ${target} – ${end} (approved)`);
  return undefined;
}

// ---- Training -------------------------------------------------------------------------------------------------------

type Course = { id: string; code: string; status: string };
type Enrolment = { id: string; status: string; overdue: boolean; dueDate: string | null; completedOn: string | null; employee: { id: string } };

async function course(kit: Kit, code: string): Promise<Course | undefined> {
  const courses = (await (await kit.as(HR)).get('/training/courses?manage=true&pageSize=100')) as Course[];
  return courses.find((c) => c.code === code);
}

async function enrolmentsIn(kit: Kit, courseId: string): Promise<Enrolment[]> {
  return (await (await kit.as(HR)).get(`/training/enrollments?view=team&courseId=${courseId}&pageSize=100`)) as Enrolment[];
}

/** SEC-101 assigned to Pooja by HR with a due date that has passed (assignments can't be due in the past, so it's moved back). */
async function overdueTraining(kit: Kit) {
  const hr = await kit.as(HR);
  const sec = await course(kit, 'SEC-101');
  if (!sec) throw new Error('Course SEC-101 not found');
  const pooja = await kit.person('pooja@acme.test');
  const open = async () => (await enrolmentsIn(kit, sec.id)).find((e) => e.employee.id === pooja.employeeId && (e.status === 'ENROLLED' || e.status === 'IN_PROGRESS'));
  let e = await open();
  if (e?.overdue) return 'skipped';
  if (!e) {
    await hr.post('/training/assignments', { courseId: sec.id, employeeIds: [pooja.employeeId], dueDate: kit.day(7) });
    e = await open();
    if (!e) throw new Error('The SEC-101 assignment for Pooja was not created');
  }
  const assigned = at(kit.day(-36), '10:30');
  await kit.sql(`UPDATE training_enrollments SET due_date = :due, created_at = :assigned, updated_at = :assigned WHERE id = :id`, { id: e.id, due: kit.day(-6), assigned });
  await kit.sql(`UPDATE notifications SET created_at = :assigned, body = :body WHERE user_id = :user AND type = 'training.assigned' AND link = :link`, { assigned, body: `Complete it by ${kit.day(-6)}.`, user: pooja.userId, link: `/me/training/enrollments/${e.id}` });
  kit.log(`Pooja Bhat: SEC-101 due ${kit.day(-6)}, not completed`);
  return undefined;
}

/** A compliance course with 12-month certificates (SEC-101 has none): Karthik's expires in 20 days, Farhan's lapsed. */
async function certificates(kit: Kit) {
  const hr = await kit.as(HR);
  let posh = await course(kit, 'POSH-101');
  let changed = false;
  if (!posh) {
    posh = (await hr.post('/training/courses', {
      code: 'POSH-101',
      title: 'Prevention of sexual harassment (POSH)',
      description: 'What harassment at work is, how to report it, and how the Internal Committee handles complaints. Renew every year.',
      category: 'COMPLIANCE',
      delivery: 'SELF_PACED',
      contentUrl: 'https://learn.example.com/posh',
      durationHours: 1.5,
      mandatory: true,
      selfEnrollment: true,
      validityMonths: 12,
    })) as Course;
    changed = true;
  }
  if (posh.status === 'DRAFT') {
    await hr.post(`/training/courses/${posh.id}/publish`);
    changed = true;
  }
  for (const [email, expiresIn] of [['karthik@acme.test', 20], ['farhan@acme.test', -25]] as const) {
    const p = await kit.person(email);
    let e = (await enrolmentsIn(kit, posh.id)).find((x) => x.employee.id === p.employeeId && x.status === 'COMPLETED');
    const expiresOn = kit.day(expiresIn);
    const completedOn = addMonths(expiresOn, -12);
    if (e?.completedOn === completedOn) continue;
    if (!e) {
      const learner = await kit.as(email);
      const enrolled = (await learner.post(`/training/courses/${posh.id}/enroll`)) as Enrolment;
      await learner.post(`/training/enrollments/${enrolled.id}/start`);
      await learner.post(`/training/enrollments/${enrolled.id}/done`);
      e = enrolled;
    }
    await kit.sql(
      `UPDATE training_enrollments SET completed_on = :completedOn, expires_on = :expiresOn, started_at = :started, completed_at = :completed, created_at = :started, updated_at = :completed WHERE id = :id`,
      { id: e.id, completedOn, expiresOn, started: at(addDays(completedOn, -2), '15:00'), completed: at(completedOn, '16:20') },
    );
    kit.log(`${p.name}: POSH-101 completed ${completedOn}, certificate ${expiresIn < 0 ? 'expired' : 'expires'} ${expiresOn}`);
    changed = true;
  }
  return changed ? undefined : 'skipped';
}

/** A live online course with a session next week that Pooja has signed up for. */
async function virtualSession(kit: Kit) {
  const hr = await kit.as(HR);
  let changed = false;
  let git = await course(kit, 'GIT-201');
  if (!git) {
    git = (await hr.post('/training/courses', {
      code: 'GIT-201',
      title: 'Git workflows for teams (live)',
      description: 'Trunk-based development, small pull requests, rebasing safely and recovering from mistakes. Live on Google Meet with Q&A.',
      category: 'TECHNICAL',
      delivery: 'VIRTUAL',
      provider: 'Acme Engineering Academy',
      durationHours: 2,
      selfEnrollment: true,
    })) as Course;
    changed = true;
  }
  if (git.status === 'DRAFT') {
    await hr.post(`/training/courses/${git.id}/publish`);
    changed = true;
  }
  const detail = (await hr.get(`/training/courses/${git.id}`)) as { sessions: { id: string; startsAt: string; status: string }[] };
  let session = detail.sessions.find((s) => s.status === 'SCHEDULED' && new Date(s.startsAt).getTime() > Date.now());
  if (!session) {
    let day = kit.day(7);
    while (weekday(day) !== 3) day = addDays(day, 1);
    const starts = new Date(at(day, '15:00'));
    await hr.post(`/training/courses/${git.id}/sessions`, {
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 2 * 3_600_000).toISOString(),
      location: 'Online — Google Meet (meet.google.com/acm-gitw-201)',
      trainer: 'Rajesh Kumar',
      capacity: 30,
    });
    session = ((await hr.get(`/training/courses/${git.id}`)) as typeof detail).sessions.find((s) => s.status === 'SCHEDULED' && new Date(s.startsAt).getTime() > Date.now())!;
    kit.log(`GIT-201 live session on ${day} at 15:00`);
    changed = true;
  }
  const pooja = await kit.person('pooja@acme.test');
  if (!(await enrolmentsIn(kit, git.id)).some((e) => e.employee.id === pooja.employeeId && (e.status === 'ENROLLED' || e.status === 'IN_PROGRESS'))) {
    await (await kit.as('pooja@acme.test')).post(`/training/courses/${git.id}/enroll`, { sessionId: session.id });
    changed = true;
  }
  return changed ? undefined : 'skipped';
}

// ---- Performance ----------------------------------------------------------------------------------------------------

/** Sneha's plan started four weeks ago (check-ins can't be dated before it), with check-ins three and one week ago. */
async function pipCheckIns(kit: Kit) {
  const sales = await kit.as('sales.manager@acme.test');
  const sneha = await kit.person('sneha@acme.test');
  const pips = (await sales.get('/performance/pips?view=managed&status=ACTIVE&pageSize=100')) as { id: string; employee: { id: string } }[];
  const pip = pips.find((p) => p.employee.id === sneha.employeeId);
  if (!pip) throw new Error('Sneha has no active improvement plan');
  const detail = (await sales.get(`/performance/pips/${pip.id}`)) as { startDate: string; checkIns: { checkInDate: string }[] };
  const CHECK_INS = [
    { checkInDate: kit.day(-21), progress: 'SOME_PROGRESS', note: 'Pipeline up from 1.4× to 1.9× of target. Three demos this week; needs to qualify leads earlier.' },
    { checkInDate: kit.day(-7), progress: 'ON_TRACK', note: 'Pipeline at 2.6× of target and two demos booked every week. Keep the weekly CRM review going.' },
  ];
  const missing = CHECK_INS.filter((c) => !detail.checkIns.some((x) => x.checkInDate === c.checkInDate));
  if (detail.checkIns.length >= CHECK_INS.length || !missing.length) return 'skipped';
  const start = kit.day(-28);
  if (detail.startDate > start) await kit.sql(`UPDATE performance_pips SET start_date = :start, created_at = :created WHERE id = :id`, { id: pip.id, start, created: at(start, '12:00') });
  for (const c of missing) {
    await sales.post(`/performance/pips/${pip.id}/check-ins`, c);
    await kit.sql(`UPDATE pip_check_ins SET created_at = :created WHERE pip_id = :id AND check_in_date = :date`, { id: pip.id, date: c.checkInDate, created: at(c.checkInDate, '17:00') });
  }
  kit.log(`Sneha Gupta: ${missing.length} check-in(s) on the improvement plan`);
  return undefined;
}

type Review = { id: string; stage: string; cycle: { id: string; status: string } };

const activeReview = async (kit: Kit, email: string) => {
  const reviews = (await (await kit.as(email)).get('/performance/reviews?view=mine&pageSize=100')) as Review[];
  const review = reviews.find((r) => r.cycle.status === 'ACTIVE');
  if (!review) throw new Error(`${email} has no review in an active cycle`);
  return review;
};

/** Pooja submits the goals she drafted; they wait for Priya (not approved here). */
async function poojaGoals(kit: Kit) {
  const review = await activeReview(kit, 'pooja@acme.test');
  if (review.stage !== 'GOAL_SETTING') return 'skipped';
  await (await kit.as('pooja@acme.test')).post(`/performance/reviews/${review.id}/goals/submit`);
  return undefined;
}

/** Asha asks Divya and Pooja for feedback; Divya answers, Pooja's request stays open. */
async function peerFeedback(kit: Kit) {
  const review = await activeReview(kit, ASHA);
  const asha = await kit.person(ASHA);
  type Request = { id: string; status: string; subject: { id: string } | null; cycle: { id: string } };
  const requestOf = async (email: string) => ((await (await kit.as(email)).get('/performance/feedback')) as Request[]).find((f) => f.subject?.id === asha.employeeId && f.cycle.id === review.cycle.id);
  let changed = false;
  const missing: string[] = [];
  for (const email of ['divya@acme.test', 'pooja@acme.test']) if (!(await requestOf(email))) missing.push((await kit.person(email)).employeeId);
  if (missing.length) {
    await (await kit.as(ASHA)).post(`/performance/reviews/${review.id}/feedback-requests`, { employeeIds: missing });
    changed = true;
  }
  const divya = await requestOf('divya@acme.test');
  if (divya?.status === 'REQUESTED') {
    await (await kit.as('divya@acme.test')).post(`/performance/feedback/${divya.id}`, {
      rating: 4,
      strengths: 'Explains the payments domain patiently and unblocks the team quickly during incidents.',
      improvements: 'Could delegate more of the API v2 migration so others build the same depth.',
    });
    changed = true;
  }
  return changed ? undefined : 'skipped';
}

// ---- Benefits -------------------------------------------------------------------------------------------------------

/** Farhan married 12 days ago and adds his wife to the family cover: life-event changes always need HR approval. */
async function pendingBenefit(kit: Kit) {
  const hr = await kit.as(HR);
  const plans = (await hr.get('/benefits/plans?pageSize=100')) as { id: string; name: string; status: string }[];
  const plan = plans.find((p) => p.name.startsWith('Group health') && p.status === 'ACTIVE');
  if (!plan) throw new Error('No active Group health plan');
  const farhan = await kit.as('farhan@acme.test');
  const mine = (await farhan.get('/benefits/me')) as { plans: { id: string; pending: Json | null; current: Json | null }[]; dependents: { id: string; relationship: string }[] };
  const offered = mine.plans.find((p) => p.id === plan.id);
  if (!offered) throw new Error(`${plan.name} is not offered to Farhan`);
  if (offered.pending || offered.current) return 'skipped';
  const person = await kit.person('farhan@acme.test');
  const spouseId =
    mine.dependents.find((d) => d.relationship === 'SPOUSE')?.id ??
    ((await hr.post(`/employees/${person.employeeId}/family`, { name: 'Zoya Ali', relationship: 'SPOUSE', dateOfBirth: '1997-02-11', gender: 'FEMALE', isDependent: true })) as Json).id;
  const options = ((await hr.get(`/benefits/plans/${plan.id}`)) as { options: { id: string; name: string }[] }).options;
  const family = options.find((o) => o.name === 'Family');
  if (!family) throw new Error(`${plan.name} has no Family option`);
  await farhan.post(`/benefits/plans/${plan.id}/enroll`, {
    optionId: family.id,
    dependentIds: [spouseId],
    lifeEvent: 'MARRIAGE',
    lifeEventDate: kit.day(-12),
    note: `Married on ${kit.day(-12)}; please add my wife Zoya to the family cover.`,
  });
  return undefined;
}

// ---- Recruitment ----------------------------------------------------------------------------------------------------

const RESUMES = [
  { email: 'sanjay.rao@candidates.test', name: 'Sanjay Rao', lines: ['Systems Engineer, Infosys (2 years)', 'Skills: Java, Spring Boot, SQL, REST APIs', 'Built batch jobs for a retail banking client; on-call for the settlement module.', 'B.E. Computer Science, PES University, 2023'] },
  { email: 'ravi.kumar@candidates.test', name: 'Ravi Kumar', lines: ['Software Engineer, Flipkart (4.5 years)', 'Skills: TypeScript, Node.js, PostgreSQL, Kafka', 'Owned the refunds service (8k requests/s); cut p95 latency from 380 ms to 140 ms.', 'B.Tech Information Technology, NIT Trichy, 2020'] },
  { email: 'lata.pillai@candidates.test', name: 'Lata Pillai', lines: ['Senior Engineer, Razorpay (6 years)', 'Skills: Go, PostgreSQL, Redis, System design', 'Designed the payouts ledger and led a team of four through the UPI 2.0 launch.', 'M.Tech Computer Science, IIIT Bangalore, 2018'] },
];

/** PDF resumes, so interviewers and recruiters get a Resume button. */
async function resumes(kit: Kit) {
  const recruiter = await kit.as('recruiter@acme.test');
  let uploaded = 0;
  for (const r of RESUMES) {
    const found = ((await recruiter.get(`/recruitment/candidates?search=${encodeURIComponent(r.email)}&pageSize=100`)) as { id: string; email: string; resume: Json | null }[]).find((c) => c.email === r.email);
    if (!found) throw new Error(`Candidate ${r.name} not found`);
    if (found.resume) continue;
    await recruiter.upload(`/recruitment/candidates/${found.id}/resume`, {}, await pdf(`${r.name.replace(' ', '-')}-resume.pdf`, r.name, [r.email, ...r.lines]));
    uploaded++;
  }
  return uploaded ? undefined : 'skipped';
}
