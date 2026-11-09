import { GRIEVANCE_RESOLUTION_DAYS, POSH_INQUIRY_DAYS, type GrievanceOutcome } from '../../contracts';
import { addDays } from '../../common/utils/zoned-time';
import type { As, Json, Kit } from './kit';

const OPEN = ['SUBMITTED', 'IN_REVIEW', 'INVESTIGATING'];
const COMMITTEE_ROLE = 'Internal Committee';

/** Where a scenario leaves its case. ACCEPTED = resolved, then accepted by the complainant (closes it). */
type Goal = 'IN_REVIEW' | 'INVESTIGATING' | 'RESOLVED' | 'ACCEPTED' | 'CLOSED' | 'WITHDRAWN';
const RANK: Record<Goal, number> = { IN_REVIEW: 1, INVESTIGATING: 2, RESOLVED: 3, ACCEPTED: 4, CLOSED: 4, WITHDRAWN: 4 };

interface CaseFlow {
  complainant: string;
  /** Handles the case: a grievance manager, or an Internal Committee member for POSH. */
  handler: string;
  assignee: string;
  case: Json & { subject: string };
  goal: Goal;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  notes?: { body: string; visibility?: 'SHARED' | 'INTERNAL' }[];
  resolution?: { outcome: GrievanceOutcome; summary: string; actions?: string };
  withdrawReason?: string;
  /**
   * Moves the case into the past (days ago): submission, and each event type of its timeline; the target date follows
   * the submission. Applied once, while the case still carries a later submission date.
   */
  backdate?: { submitted: number; events: Record<string, number>; notes?: number };
}

/** Takes a case from wherever it is to its goal, one API step at a time; 'skipped' when it is already there. */
async function runFlow(kit: Kit, f: CaseFlow): Promise<'skipped' | void> {
  const me = await kit.as(f.complainant);
  const handler = await kit.as(f.handler);
  let changed = false;
  const mine = (await me.get('/grievances/mine?pageSize=100')) as Json[];
  let id = mine.find((c) => c.subject === f.case.subject)?.id as string | undefined;
  if (!id) {
    if (!f.case.category) throw new Error(`The demo case "${f.case.subject}" is missing; run npm run db:seed:demo first`);
    id = (await me.post('/grievances', f.case)).id as string;
    changed = true;
  }
  let c = await handler.get(`/grievances/${id}`);
  const act = async (as: As, path: string, body: unknown = {}) => {
    c = await as.post(`/grievances/${id}/${path}`, body);
    changed = true;
  };
  const assigneeUserId = (await kit.person(f.assignee)).userId;
  if (OPEN.includes(c.status) && !c.assignee) await act(handler, 'assign', { assigneeUserId });
  // A handler's notes as soon as the case is assigned, so the timeline reads in order.
  if (f.goal !== 'WITHDRAWN') {
    for (const n of f.notes ?? []) {
      if (c.notes.some((x: Json) => x.body === n.body) || !OPEN.includes(c.status)) continue;
      await act(handler, 'notes', { body: n.body, visibility: n.visibility ?? 'SHARED' });
    }
  }
  if (f.priority && c.priority !== f.priority && OPEN.includes(c.status)) {
    c = await handler.patch(`/grievances/${id}`, { priority: f.priority });
    changed = true;
  }
  if (f.goal === 'WITHDRAWN') {
    if (OPEN.includes(c.status)) await act(me, 'withdraw', { reason: f.withdrawReason ?? null });
  } else {
    if (RANK[f.goal] >= RANK.INVESTIGATING && c.status === 'IN_REVIEW') await act(handler, 'investigate');
    if (RANK[f.goal] >= RANK.RESOLVED && c.status === 'INVESTIGATING') await act(handler, 'resolve', f.resolution);
    if (f.goal === 'ACCEPTED' && c.status === 'RESOLVED') await act(me, 'accept');
    if (f.goal === 'CLOSED' && c.status === 'RESOLVED') await act(handler, 'close');
  }
  if (f.backdate && (changed || c.submittedOn > kit.day(-f.backdate.submitted))) {
    await backdateCase(kit, id, c.posh, f.backdate);
    changed = true;
  }
  return changed ? undefined : 'skipped';
}

/**
 * One statement, so a failure can't leave the timeline half moved. Only rows from the last few hours move, so steps
 * added by a later run join the timeline without shifting the earlier ones twice.
 */
async function backdateCase(kit: Kit, id: string, posh: boolean, plan: NonNullable<CaseFlow['backdate']>) {
  const days = (type: string) => plan.events[type] ?? 0;
  const types = Object.keys(plan.events);
  const whens = types.map((_, i) => `WHEN :t${i} THEN :d${i}`).join(' ');
  const typeParams = Object.fromEntries(types.flatMap((t, i) => [[`t${i}`, t], [`d${i}`, plan.events[t]]]));
  const submittedOn = kit.day(-plan.submitted);
  const resolved = days('RESOLVED');
  const fresh = (column: string) => `${column} > now() - interval '12 hours'`;
  const shift = (column: string, days: string) => `${column} = CASE WHEN ${fresh(column)} THEN ${column} - make_interval(days => ${days}) ELSE ${column} END`;
  await kit.sql(
    `WITH ev AS (
       UPDATE grievance_events SET created_at = created_at - make_interval(days => CASE type ${whens} ELSE 0 END)
        WHERE case_id = :id AND organization_id = :orgId AND ${fresh('created_at')} RETURNING 1
     ), nt AS (
       UPDATE grievance_notes SET created_at = created_at - make_interval(days => :notes)
        WHERE case_id = :id AND organization_id = :orgId AND ${fresh('created_at')} RETURNING 1
     )
     UPDATE grievance_cases SET
       submitted_on = CAST(:submittedOn AS date), due_on = CAST(:dueOn AS date),
       resolved_on = CASE WHEN ${fresh('resolved_at')} THEN CAST(:resolvedOn AS date) ELSE resolved_on END,
       ${shift('created_at', ':submitted')},
       ${shift('acknowledged_at', ':acknowledged')},
       ${shift('resolved_at', ':resolved')},
       ${shift('accepted_at', ':closed')},
       ${shift('closed_at', ':closed')},
       ${shift('withdrawn_at', ':withdrawn')}
      WHERE id = :id AND organization_id = :orgId
     RETURNING id`,
    {
      ...typeParams,
      id,
      notes: plan.notes ?? 0,
      submitted: plan.submitted,
      submittedOn,
      dueOn: addDays(submittedOn, posh ? POSH_INQUIRY_DAYS : GRIEVANCE_RESOLUTION_DAYS),
      acknowledged: days('ACKNOWLEDGED') || days('INVESTIGATING'),
      resolved,
      resolvedOn: kit.day(-resolved),
      closed: days('ACCEPTED') || days('CLOSED'),
      withdrawn: days('WITHDRAWN'),
    },
  );
}

/** A custom role with the restricted POSH permission, held by Kavita (presiding officer) and Rohan. */
async function seedCommittee(kit: Kit): Promise<'skipped' | void> {
  const admin = await kit.as('admin@acme.test');
  let changed = false;
  const grants = [{ key: 'grievance.posh.access', scope: 'ORGANIZATION' }];
  const existing = ((await admin.get('/roles')) as Json[]).find((r) => r.name === COMMITTEE_ROLE);
  let role: Json;
  if (!existing) {
    role = await admin.post('/roles', { name: COMMITTEE_ROLE, description: 'Members of the Internal Committee under the POSH Act: receive, inquire into and conclude sexual harassment complaints.', permissions: grants });
    changed = true;
  } else {
    role = await admin.get(`/roles/${existing.id}`);
    if (!(role.permissions as Json[]).some((p) => p.key === 'grievance.posh.access')) {
      role = await admin.put(`/roles/${role.id}/permissions`, { permissions: [...role.permissions, ...grants] });
      changed = true;
    }
  }
  for (const email of ['hr.director@acme.test', 'hr.executive@acme.test']) {
    const member = ((await admin.get(`/users?search=${encodeURIComponent(email)}`)) as Json[]).find((u) => u.email === email);
    if (!member) throw new Error(`No user ${email}`);
    if ((member.roles as Json[]).some((r) => r.id === role.id)) continue;
    await admin.put(`/users/${member.id}/roles`, { roleIds: [...(member.roles as Json[]).map((r) => r.id), role.id] });
    changed = true;
  }
  return changed ? undefined : 'skipped';
}

export async function seedGrievanceExtras(kit: Kit): Promise<void> {
  const neha = 'hr.manager@acme.test';
  const kavita = 'hr.director@acme.test';

  await kit.step('Cases: Farhan’s travel allowance grievance resolved (awaiting his review)', () =>
    runFlow(kit, {
      complainant: 'farhan@acme.test',
      handler: neha,
      assignee: neha,
      case: { subject: 'Travel allowance not received' },
      goal: 'RESOLVED',
      notes: [{ body: 'I have checked with payroll: your claim was approved on time but was not picked up in last month’s payout batch.' }],
      resolution: {
        outcome: 'UPHELD',
        summary: 'Payroll confirmed that your approved travel claim for the Mumbai client visit missed last month’s payout batch. The full amount will be paid with this month’s salary and shown as a separate line on your payslip.',
        actions: 'Payroll now reconciles approved claims against the payout batch before each run.',
      },
    }),
  );

  await kit.step('Cases: Divya’s cab-drop grievance resolved and accepted (closed)', () =>
    runFlow(kit, {
      complainant: 'divya@acme.test',
      handler: neha,
      assignee: neha,
      case: {
        category: 'WORKPLACE',
        subject: 'No cab drop after late release support',
        description: 'When our team stays back for evening release support there is no company cab for the drop home after 9 pm, and booking a taxi late at night is difficult and expensive.',
      },
      goal: 'ACCEPTED',
      notes: [{ body: 'The transport desk is reviewing the late-evening roster with the Engineering managers. We will update you this week.' }],
      resolution: {
        outcome: 'UPHELD',
        summary: 'The transport desk has added 9:30 pm and 11 pm cab drops on release days. Team leads book seats through the transport portal by 6 pm on the day.',
        actions: 'Facilities to review cab usage after one month.',
      },
      backdate: { submitted: 21, events: { SUBMITTED: 21, ASSIGNED: 20, ACKNOWLEDGED: 20, INVESTIGATING: 18, RESOLVED: 6, ACCEPTED: 4 }, notes: 15 },
    }),
  );

  await kit.step('Cases: Pooja’s seating grievance withdrawn', () =>
    runFlow(kit, {
      complainant: 'pooja@acme.test',
      handler: neha,
      assignee: neha,
      case: {
        category: 'WORKPLACE',
        subject: 'Seat allocation in the new Engineering bay',
        description: 'I was moved to a seat far from my team in the new Engineering bay, which makes pairing sessions and stand-ups difficult.',
      },
      goal: 'WITHDRAWN',
      withdrawReason: 'The facilities team found me a seat next to my team, so this is sorted.',
      backdate: { submitted: 9, events: { SUBMITTED: 9, ASSIGNED: 8, ACKNOWLEDGED: 8, WITHDRAWN: 3 }, notes: 3 },
    }),
  );

  await kit.step('Cases: Karthik’s compensatory-off grievance past its 30-day target', () =>
    runFlow(kit, {
      complainant: 'karthik@acme.test',
      handler: neha,
      assignee: neha,
      case: {
        category: 'PAY_BENEFITS',
        subject: 'Compensatory off not credited for weekend release work',
        description: 'I worked two weekend days for the payments release with my manager’s approval, but the compensatory off days have not been credited to my leave balance.',
      },
      goal: 'INVESTIGATING',
      notes: [
        { body: 'We are checking the weekend attendance records with your manager and will update you shortly.' },
        { body: 'Waiting for the weekend attendance sign-off from the Engineering manager before the leave team can credit the days.', visibility: 'INTERNAL' },
      ],
      backdate: { submitted: 35, events: { SUBMITTED: 35, ASSIGNED: 33, ACKNOWLEDGED: 33, INVESTIGATING: 28 }, notes: 20 },
    }),
  );

  await kit.step('Cases: Sneha’s blocked emergency exit (urgent)', () =>
    runFlow(kit, {
      complainant: 'sneha@acme.test',
      handler: neha,
      assignee: neha,
      case: {
        category: 'SAFETY',
        subject: 'Emergency exit blocked at the Pune office',
        description: 'The emergency exit next to the Pune office pantry has been blocked by stacked cartons from the recent furniture delivery for three days. It could not be used in an evacuation.',
        incidentLocation: 'Pune Office — pantry corridor',
      },
      goal: 'IN_REVIEW',
      priority: 'URGENT',
      notes: [{ body: 'Asked the Pune facilities lead to clear the corridor today and confirm with photos.', visibility: 'INTERNAL' }],
      backdate: { submitted: 1, events: { SUBMITTED: 1 } },
    }),
  );

  await kit.step('Cases: Internal Committee role for Kavita and Rohan', () => seedCommittee(kit));

  await kit.step('Cases: POSH complaint concluded by the Internal Committee', () =>
    runFlow(kit, {
      complainant: 'recruiter@acme.test',
      handler: kavita,
      assignee: kavita,
      case: {
        category: 'POSH',
        subject: 'Inappropriate remarks by a vendor representative',
        description: 'During recruitment drives over the past month, a representative of one of our staffing vendors repeatedly made personal remarks about my appearance and sent unwelcome personal messages after I asked him to keep our communication professional.',
        respondentName: 'Staffing vendor representative',
        incidentDate: kit.day(-75),
        incidentLocation: 'Bengaluru HQ — interview rooms',
        witnesses: 'A colleague from the recruitment team was present during one of the drives.',
      },
      goal: 'CLOSED',
      notes: [{ body: 'The Committee recorded the complainant’s statement. The vendor representative received a copy of the complaint and was given the opportunity to respond in writing.', visibility: 'INTERNAL' }],
      resolution: {
        outcome: 'UPHELD',
        summary: 'The Internal Committee completed its inquiry and found the complaint substantiated. The vendor has withdrawn the representative from our account and all vendor communication now goes through the recruitment lead. Please contact the Committee if you need any further support.',
        actions: 'Written notice issued to the vendor; an awareness session for vendor partners is scheduled for next quarter.',
      },
      backdate: { submitted: 62, events: { SUBMITTED: 62, ASSIGNED: 61, ACKNOWLEDGED: 61, INVESTIGATING: 58, RESOLVED: 12, CLOSED: 10 }, notes: 40 },
    }),
  );

  await kit.step('Cases: POSH complaint under inquiry', () =>
    runFlow(kit, {
      complainant: 'team.lead@acme.test',
      handler: kavita,
      assignee: 'hr.executive@acme.test',
      case: {
        category: 'POSH',
        subject: 'Unwelcome conduct by a client team member',
        description: 'A member of a client’s project team has made unwelcome comments of a personal nature during video calls and sent messages outside work hours that made me uncomfortable. I asked him to stop, but it has continued.',
        respondentName: 'Client project team member',
        incidentDate: kit.day(-24),
        interimRelief: 'I would prefer not to attend calls with this person while the inquiry is in progress.',
      },
      goal: 'INVESTIGATING',
      notes: [{ body: 'Interim relief agreed: a colleague attends the client calls in the complainant’s place during the inquiry. Inquiry meetings are scheduled for next week.', visibility: 'INTERNAL' }],
      backdate: { submitted: 21, events: { SUBMITTED: 21, ASSIGNED: 20, ACKNOWLEDGED: 20, INVESTIGATING: 17 }, notes: 10 },
    }),
  );
}
