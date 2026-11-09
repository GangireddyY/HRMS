import { addDays, addMonths } from '../../common/utils/zoned-time';
import { occurrences } from '../../modules/compliance/compliance-rules';
import { PDF, type As, type Json, type Kit } from './kit';

/** A timestamp on a past day, mid-morning in the organization's time zone. */
const at = (date: string, time = '10:30') => `${date}T${time}:00+05:30`;

async function policyByTitle(hr: As, title: string): Promise<Json | null> {
  const rows = (await hr.get(`/compliance/policies?pageSize=100&search=${encodeURIComponent(title)}`)) as Json[];
  const found = rows.find((p) => p.title === title);
  return found ? hr.get(`/compliance/policies/${found.id}`) : null;
}

/** Moves a published version (and, optionally, the next review) into the past. */
async function backdateVersion(kit: Kit, versionId: string, publishedOn: string) {
  await kit.sql(`UPDATE policy_versions SET published_on = :d, effective_from = :d, published_at = :at WHERE id = :id AND organization_id = :orgId`, { id: versionId, d: publishedOn, at: at(publishedOn) });
}

/** Acknowledges the current version as each person (if they haven't); returns how many did. */
async function acknowledge(kit: Kit, policyId: string, emails: string[]): Promise<number> {
  let n = 0;
  for (const email of emails) {
    const as = await kit.as(email);
    const read = await as.get(`/compliance/policies/${policyId}/read`);
    if (!read.canAcknowledge) continue;
    await as.post(`/compliance/policies/${policyId}/acknowledge`, { versionId: read.version.id });
    n++;
  }
  return n;
}

/** Dates the acknowledgements of a version, a day apart from `firstOn`. */
async function backdateAcks(kit: Kit, versionId: string, emails: string[], firstOn: string) {
  for (const [i, email] of emails.entries()) {
    const { employeeId } = await kit.person(email);
    await kit.sql(`UPDATE policy_acknowledgements SET acknowledged_at = :at WHERE version_id = :v AND employee_id = :e AND organization_id = :orgId`, { v: versionId, e: employeeId, at: at(addDays(firstOn, i), `1${i}:15`) });
  }
}

const v = (p: Json, n: number) => (p.versions as Json[]).find((x) => x.version === n);

export async function seedComplianceExtras(kit: Kit): Promise<void> {
  const hr = await kit.as('hr.manager@acme.test');

  // Published three weeks ago with 7 days to acknowledge: everyone who hasn't is overdue (Asha among them).
  await kit.step('Cases: “Acceptable use of IT” acknowledgements overdue', async () => {
    const p = await policyByTitle(hr, 'Acceptable use of IT');
    if (!p) throw new Error('The demo policy "Acceptable use of IT" is missing; run npm run db:seed:demo first');
    const v1 = v(p, 1)!;
    const publishedOn = kit.day(-21);
    const ackers = ['karthik@acme.test', 'divya@acme.test'];
    const acked = await acknowledge(kit, p.id, ackers);
    if (v1.publishedOn <= publishedOn && !acked) return 'skipped';
    await backdateVersion(kit, v1.id, publishedOn);
    await backdateAcks(kit, v1.id, ackers, addDays(publishedOn, 2));
  });

  // v1 a month ago (acknowledged by Asha and Karthik), v2 today with "acknowledge again".
  await kit.step('Cases: “Code of conduct” version 2 to re-acknowledge', async () => {
    const p = await policyByTitle(hr, 'Code of conduct');
    if (!p) throw new Error('The demo policy "Code of conduct" is missing; run npm run db:seed:demo first');
    if ((p.versions as Json[]).some((x) => x.version >= 2 && x.status !== 'DRAFT')) return 'skipped';
    const v1 = v(p, 1)!;
    if (v1.publishedOn > kit.day(-30)) {
      await backdateVersion(kit, v1.id, kit.day(-30));
      await backdateAcks(kit, v1.id, ['employee@acme.test', 'karthik@acme.test'], kit.day(-28));
    }
    await hr.put(`/compliance/policies/${p.id}/draft`, {
      content:
        'Treat everyone with respect. Avoid conflicts of interest and declare any that arise. Protect customer data. Gifts and hospitality from customers or vendors above ₹2,000 must be declared to your manager and HR. Report concerns to your manager, HR or the ethics helpline — anonymously if you prefer — without fear of retaliation.',
      changeSummary: 'Adds rules on gifts and hospitality and an anonymous way to report concerns.',
      reacknowledge: true,
    });
    await hr.post(`/compliance/policies/${p.id}/publish`);
  });

  // The Sales team's travel policy: everyone in Sales acknowledged it, and its yearly review is overdue.
  await kit.step('Cases: “Sales travel and expenses” fully acknowledged, review overdue', async () => {
    const title = 'Sales travel and expenses';
    const ackers = ['sales.manager@acme.test', 'farhan@acme.test', 'sneha@acme.test'];
    let p = await policyByTitle(hr, title);
    let changed = false;
    if (!p) {
      p = await hr.post('/compliance/policies', {
        title,
        category: 'TRAVEL',
        summary: 'Booking client travel, daily allowances and claiming expenses',
        departmentIds: [(await kit.person('farhan@acme.test')).departmentId],
        ackDueDays: 14,
        reviewMonths: 12,
        content: 'Book client travel through the travel desk at least three days ahead. Train or economy air for journeys over 300 km. A daily allowance of ₹1,500 covers meals on out-station days. Claim expenses within 30 days with receipts.',
      });
      changed = true;
    }
    if (p!.status === 'DRAFT') {
      p = await hr.post(`/compliance/policies/${p!.id}/publish`);
      changed = true;
    }
    if (await acknowledge(kit, p!.id, ackers)) changed = true;
    const v1 = v(p!, 1)!;
    const publishedOn = addMonths(kit.today, -13);
    if (v1.publishedOn > publishedOn) {
      await backdateVersion(kit, v1.id, publishedOn);
      await kit.sql(`UPDATE policies SET next_review_on = :d WHERE id = :id AND organization_id = :orgId`, { id: p!.id, d: addMonths(publishedOn, 12) });
      await backdateAcks(kit, v1.id, ackers, addDays(publishedOn, 2));
      changed = true;
    }
    return changed ? undefined : 'skipped';
  });

  await kit.step('Cases: “Hybrid work policy” draft', async () => {
    if (await policyByTitle(hr, 'Hybrid work policy')) return 'skipped';
    await hr.post('/compliance/policies', {
      title: 'Hybrid work policy',
      category: 'HR',
      summary: 'Office and home working days, and core collaboration hours',
      ackDueDays: 14,
      reviewMonths: 12,
      content: 'Employees may work from home up to two days a week with their manager’s agreement. Core collaboration hours are 11 am to 4 pm. Each team agrees its office days every quarter.',
    });
  });

  // Replaced by the hybrid work policy; published (without acknowledgements) a while ago, then retired.
  await kit.step('Cases: “Work from home guidelines (2024)” retired', async () => {
    const title = 'Work from home guidelines (2024)';
    let p = await policyByTitle(hr, title);
    if (p?.status === 'RETIRED') return 'skipped';
    if (!p) {
      p = await hr.post('/compliance/policies', {
        title,
        category: 'HR',
        summary: 'Interim guidelines for working from home',
        requiresAck: false,
        content: 'Work from home needs your manager’s approval a day in advance. Stay reachable on chat during working hours and join the daily stand-up on video.',
      });
    }
    if (p!.status === 'DRAFT') p = await hr.post(`/compliance/policies/${p!.id}/publish`);
    await backdateVersion(kit, v(p!, 1)!.id, addMonths(kit.today, -20));
    await hr.post(`/compliance/policies/${p!.id}/retire`);
  });

  // The recommended obligations start on the day they were added; an earlier start puts recent due dates on the calendar.
  await kit.step('Cases: statutory calendar with overdue filings', async () => {
    const startsOn = kit.day(-45);
    const obligations = (await hr.get('/compliance/obligations')) as Json[];
    let changed = false;
    for (const title of ['PF contributions and ECR', 'ESI contributions', 'TDS deposit on salaries', 'Professional tax']) {
      const o = obligations.find((x) => x.title === title);
      if (!o) throw new Error(`The obligation "${title}" is missing; run npm run db:seed:demo first`);
      if (o.startsOn <= startsOn) continue;
      await hr.patch(`/compliance/obligations/${o.id}`, { startsOn });
      changed = true;
    }
    return changed ? undefined : 'skipped';
  });

  // TDS deposits up to date (the last two due dates) and the latest PF return, each filed a day early with the receipt;
  // ESI and professional tax stay overdue.
  await kit.step('Cases: statutory filings with receipts', async () => {
    const obligations = (await hr.get('/compliance/obligations')) as Json[];
    const plan = [
      { title: 'PF contributions and ECR', count: 1, file: 'pf-ecr-challan.pdf', reference: (d: string) => `ECR-KNBNG0012345-${d.slice(0, 7).replace('-', '')}`, note: 'ECR uploaded and challan paid through the EPFO portal.' },
      { title: 'TDS deposit on salaries', count: 2, file: 'tds-challan-281.pdf', reference: (d: string) => `CIN 0510308${d.replace(/-/g, '')}00042`, note: 'Challan 281 paid by net banking (HDFC).' },
    ];
    let changed = false;
    for (const f of plan) {
      const o = obligations.find((x) => x.title === f.title);
      if (!o) throw new Error(`The obligation "${f.title}" is missing`);
      if (o.filings >= f.count) continue;
      const due = occurrences(o as { dueDates: string[]; startsOn: string; endsOn: string | null }, o.startsOn, kit.day(-1)).slice(-f.count);
      if (!due.length) throw new Error(`"${f.title}" has no past due date to file`);
      const calendar = await hr.get(`/compliance/calendar?from=${due[0]}&to=${due[due.length - 1]}`);
      const filed = new Set((calendar.items as Json[]).filter((i) => i.obligation.id === o.id && i.filing).map((i) => i.dueOn as string));
      for (const dueOn of due.filter((d) => !filed.has(d))) {
        await hr.upload(`/compliance/obligations/${o.id}/filings`, { dueOn, completedOn: addDays(dueOn, -1), reference: f.reference(dueOn), note: f.note }, { data: PDF, name: f.file, type: 'application/pdf' });
        changed = true;
      }
    }
    return changed ? undefined : 'skipped';
  });

  // Usually PF / ESI fall within the coming week; on days when nothing does, a state levy due in five days.
  await kit.step('Cases: statutory filing due within 7 days', async () => {
    const soon = await hr.get(`/compliance/calendar?from=${kit.today}&to=${kit.day(7)}`);
    if ((soon.items as Json[]).some((i) => i.state === 'DUE_SOON')) return 'skipped';
    const obligations = (await hr.get('/compliance/obligations')) as Json[];
    if (obligations.some((o) => o.title === 'Labour welfare fund contribution')) return 'skipped';
    await hr.post('/compliance/obligations', {
      title: 'Labour welfare fund contribution',
      category: 'LWF',
      authority: 'Karnataka Labour Welfare Board',
      description: 'Employer and employee contributions to the state labour welfare fund.',
      dueDates: [kit.day(5).slice(5)],
      startsOn: kit.today,
    });
  });
}
