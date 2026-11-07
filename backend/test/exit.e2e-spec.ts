import { Employee, EmployeeLifecycleEvent, Notification } from '../src/database/models';
import { gratuityAmount, gratuityYears, serviceLength } from '../src/modules/exit/exit-rules';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgDays as days, resetDatabase, uniqueEmail } from './helpers';
type Line = { code: string; kind: string; amount: number };

describe('Exits (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], firstName: string, extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p'), firstName, lastName: 'Person' });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  async function team() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const ops = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Operations' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema', { departmentId: ops.id });
    const mgr = await person(org.organization.id, h, ['department_manager'], 'Manoj', { departmentId: eng.id });
    const pm = await person(org.organization.id, h, ['payroll_manager'], 'Priya', { departmentId: ops.id });
    const fin = await person(org.organization.id, h, ['finance_manager'], 'Farah', { departmentId: ops.id });
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { departmentId: eng.id, managerId: mgr.employee.id, dateOfJoining: '2019-01-07', noticePeriodDays: 30 });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { departmentId: ops.id });
    return { org, h, eng, ops, hr, mgr, pm, fin, asha, ben };
  }

  it('takes a resignation through acceptance, clearance, exit survey and full & final settlement', async () => {
    const t = await team();
    // Earned leave to encash and a salary (Basic = 50% of CTC = ₹30,000 a month).
    const el = (await ctx.http().post(`${API}/leave/types`).set(t.h).send({ code: 'EL', name: 'Earned leave', accrualFrequency: 'NONE', encashable: true })).body.data;
    expect((await ctx.http().post(`${API}/leave/adjustments`).set(t.h).send({ employeeId: t.asha.employee.id, leaveTypeId: el.id, kind: 'GRANT', days: 10, note: 'Opening balance' })).status).toBe(201);
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(t.h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    expect((await ctx.http().post(`${API}/payroll/employees/${t.asha.employee.id}/salaries`).set(t.pm.h).send({ structureId: structure.id, annualCtc: 720000, effectiveFrom: '2024-01-08' })).status).toBe(201);

    const resigned = await ctx.http().post(`${API}/exits/resign`).set(t.asha.h).send({ reason: 'CAREER_GROWTH', reasonDetail: 'Moving to a product role', requestedLastDay: days(10) });
    expect(resigned.status).toBe(201);
    const id = resigned.body.data.id;
    expect(resigned.body.data).toMatchObject({ status: 'SUBMITTED', noticeDays: 30, noticeEndsOn: days(29), requestedLastDay: days(10), permissions: { withdraw: true, approve: false } });
    expect((await ctx.http().post(`${API}/exits/resign`).set(t.asha.h).send({ reason: 'PERSONAL' })).status).toBe(409);
    expect(await Notification.count({ where: { userId: [t.mgr.user.id, t.hr.user.id], link: `/hr/exits/${id}` }, ...RAW })).toBe(2);

    // The manager (department scope) sees it waiting; others in another department don't.
    expect((await ctx.http().get(`${API}/exits?view=approve`).set(t.mgr.h)).body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await ctx.http().get(`${API}/exits/${id}`).set(t.ben.h)).status).toBe(404);
    expect((await ctx.http().post(`${API}/exits/${id}/approve`).set(t.asha.h).send({ lastWorkingDay: days(0) })).status).toBe(403);
    expect((await ctx.http().post(`${API}/exits/${id}/approve`).set(t.mgr.h).send({ lastWorkingDay: days(-1) })).status).toBe(422);
    const accepted = await ctx.http().post(`${API}/exits/${id}/approve`).set(t.mgr.h).send({ lastWorkingDay: days(0), note: 'Early release agreed' });
    expect(accepted.body.data).toMatchObject({ status: 'APPROVED', lastWorkingDay: days(0), shortfallDays: 29, decidedBy: 'Manoj Person', clearance: { total: 6, done: 0 } });
    const employee = await Employee.findByPk(t.asha.employee.id, RAW);
    expect(employee).toMatchObject({ status: 'ON_NOTICE', exitDate: days(0) });
    expect(await EmployeeLifecycleEvent.count({ where: { employeeId: t.asha.employee.id, type: 'STATUS_CHANGE' }, ...RAW })).toBe(1);
    expect((await ctx.http().post(`${API}/exits/${id}/withdraw`).set(t.asha.h).send({})).status).toBe(409);

    // Clearance: the manager clears the handover only; HR clears the rest (with a recovery for the laptop).
    expect((await ctx.http().post(`${API}/exits/${id}/complete`).set(t.hr.h).send({})).status).toBe(409);
    const items = accepted.body.data.clearanceItems as { id: string; department: string; title: string }[];
    const handover = items.find((i) => i.department === 'MANAGER')!;
    const laptop = items.find((i) => i.title.startsWith('Laptop'))!;
    expect((await ctx.http().patch(`${API}/exits/${id}/clearance/${laptop.id}`).set(t.mgr.h).send({ status: 'CLEARED' })).status).toBe(403);
    expect((await ctx.http().patch(`${API}/exits/${id}/clearance/${handover.id}`).set(t.asha.h).send({ status: 'CLEARED' })).status).toBe(403);
    expect((await ctx.http().patch(`${API}/exits/${id}/clearance/${handover.id}`).set(t.mgr.h).send({ status: 'CLEARED', note: 'Docs in the wiki' })).body.data.clearance.done).toBe(1);
    await ctx.http().patch(`${API}/exits/${id}/clearance/${laptop.id}`).set(t.hr.h).send({ status: 'CLEARED', recoveryAmount: 2500, note: 'Charger missing' });
    for (const i of items.filter((x) => x.id !== handover.id && x.id !== laptop.id)) await ctx.http().patch(`${API}/exits/${id}/clearance/${i.id}`).set(t.hr.h).send({ status: 'NOT_APPLICABLE' });

    // Exit survey: only HR sees the answers.
    expect((await ctx.http().post(`${API}/exits/${id}/feedback`).set(t.asha.h).send({ wouldRecommend: 8, wouldRejoin: true, liked: 'The team' })).status).toBe(201);
    expect((await ctx.http().post(`${API}/exits/${id}/feedback`).set(t.asha.h).send({ wouldRecommend: 8, wouldRejoin: true })).status).toBe(409);
    expect((await ctx.http().get(`${API}/exits/${id}`).set(t.mgr.h)).body.data.feedback).toBeUndefined();
    expect((await ctx.http().get(`${API}/exits/${id}`).set(t.hr.h)).body.data.feedback).toMatchObject({ wouldRecommend: 8, wouldRejoin: true, liked: 'The team' });

    // Full & final settlement.
    expect((await ctx.http().get(`${API}/exits/${id}/settlement`).set(t.asha.h)).body.data).toBeNull();
    expect((await ctx.http().post(`${API}/exits/${id}/settlement`).set(t.hr.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/exits/${id}/settlement`).set(t.pm.h).send({ includeGratuity: false })).status).toBe(422);
    const calc = await ctx.http().post(`${API}/exits/${id}/settlement`).set(t.pm.h).send({ adjustments: [{ label: 'Income tax (TDS)', kind: 'DEDUCTION', amount: 1500 }] });
    expect(calc.status).toBe(201);
    const s = calc.body.data;
    const gross = s.inputs.monthlyGross as number;
    const years = gratuityYears(serviceLength('2019-01-07', days(0)));
    expect(s.inputs).toMatchObject({ monthlyBasic: 30000, shortfallDays: 29, gratuity: { eligible: true } });
    expect((s.lines as Line[]).map((l) => [l.code, l.kind, l.amount])).toEqual([
      ['LEAVE_EL', 'EARNING', 11538],
      ['GRATUITY', 'EARNING', gratuityAmount(30000, years)],
      ['NOTICE_RECOVERY', 'DEDUCTION', Math.round((29 * gross) / 30)],
      [`CLEARANCE_${laptop.id.slice(0, 8)}`, 'DEDUCTION', 2500],
      ['ADJ_1', 'DEDUCTION', 1500],
    ]);
    expect(s.netPayable).toBe(11538 + gratuityAmount(30000, years) - Math.round((29 * gross) / 30) - 2500 - 1500);
    expect(s).toMatchObject({ status: 'DRAFT', calculatedBy: 'Priya Person' });

    // Recoveries are fixed once submitted; someone else approves.
    await ctx.http().post(`${API}/exits/${id}/settlement/submit`).set(t.pm.h).send({});
    expect((await ctx.http().patch(`${API}/exits/${id}/clearance/${laptop.id}`).set(t.hr.h).send({ status: 'CLEARED', recoveryAmount: 0 })).status).toBe(409);
    expect((await ctx.http().post(`${API}/exits/${id}/settlement/approve`).set(t.pm.h).send({})).status).toBe(403);
    const approved = await ctx.http().post(`${API}/exits/${id}/settlement/approve`).set(t.fin.h).send({});
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', approvedBy: 'Farah Person' });
    const balance = (await ctx.http().get(`${API}/leave/balances`).set(t.asha.h)).body.data.balances.find((b: { leaveType: { code: string } }) => b.leaveType.code === 'EL');
    expect(balance).toMatchObject({ balance: 0, encashed: 10 });

    // The employee sees the statement (without the working).
    const statement = (await ctx.http().get(`${API}/exits/${id}/settlement`).set(t.asha.h)).body.data;
    expect(statement).toMatchObject({ status: 'APPROVED', netPayable: s.netPayable });
    expect(statement.inputs).toBeUndefined();
    expect((await ctx.http().post(`${API}/exits/${id}/settlement/pay`).set(t.fin.h).send({ paidOn: days(1), reference: 'UTR1' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/exits/${id}/settlement/pay`).set(t.fin.h).send({ paidOn: days(0), reference: 'UTR20261106' })).body.data).toMatchObject({ status: 'PAID', paymentReference: 'UTR20261106' });

    // Completed on the last working day: the employee has exited.
    const done = await ctx.http().post(`${API}/exits/${id}/complete`).set(t.hr.h).send({});
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', completedBy: 'Hema Person' });
    expect(await Employee.findByPk(t.asha.employee.id, RAW)).toMatchObject({ status: 'EXITED', exitDate: days(0) });
    expect((await ctx.http().get(`${API}/exits/mine`).set(t.asha.h)).body.data.current).toMatchObject({ id, status: 'COMPLETED', settlement: { status: 'PAID' } });
  });

  it('records employer-initiated exits, cancels them and lets employees withdraw a resignation', async () => {
    const t = await team();
    expect((await ctx.http().post(`${API}/exits`).set(t.hr.h).send({ employeeId: t.hr.employee.id, type: 'TERMINATION', reason: 'OTHER', noticeGivenOn: days(0), lastWorkingDay: days(0) })).status).toBe(403);
    expect((await ctx.http().post(`${API}/exits`).set(t.mgr.h).send({ employeeId: t.ben.employee.id, type: 'TERMINATION', reason: 'PERFORMANCE', noticeGivenOn: days(0), lastWorkingDay: days(0) })).status).toBe(403);
    const terminated = await ctx.http().post(`${API}/exits`).set(t.hr.h).send({ employeeId: t.ben.employee.id, type: 'TERMINATION', reason: 'PERFORMANCE', noticeGivenOn: days(0), lastWorkingDay: days(0) });
    expect(terminated.body.data).toMatchObject({ status: 'APPROVED', type: 'TERMINATION', shortfallDays: 29 });
    const id = terminated.body.data.id;
    expect(await Employee.findByPk(t.ben.employee.id, RAW)).toMatchObject({ status: 'ON_NOTICE' });
    expect((await ctx.http().post(`${API}/exits/${id}/settlement`).set(t.pm.h).send({})).status).toBe(409);

    // Cancelling restores the employee.
    expect((await ctx.http().post(`${API}/exits/${id}/cancel`).set(t.hr.h).send({ reason: 'Resolved after review' })).body.data).toMatchObject({ status: 'CANCELLED', closedReason: 'Resolved after review' });
    expect(await Employee.findByPk(t.ben.employee.id, RAW)).toMatchObject({ status: 'ACTIVE', exitDate: null });

    // A resignation can be withdrawn until it is accepted.
    const r = (await ctx.http().post(`${API}/exits/resign`).set(t.ben.h).send({ reason: 'PERSONAL' })).body.data;
    expect((await ctx.http().post(`${API}/exits/${r.id}/withdraw`).set(t.ben.h).send({})).body.data).toMatchObject({ status: 'WITHDRAWN' });
    expect((await ctx.http().get(`${API}/exits/mine`).set(t.ben.h)).body.data).toMatchObject({ current: null, history: [expect.objectContaining({ status: 'WITHDRAWN' }), expect.objectContaining({ status: 'CANCELLED' })] });

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/exits/${id}`).set(oh)).status).toBe(404);
    expect((await ctx.http().get(`${API}/exits`).set(oh)).body.data).toEqual([]);
  });

  it('issues relieving and experience letters after the exit and keeps former employees in the alumni network', async () => {
    const t = await team();
    const designation = (await ctx.http().post(`${API}/designations`).set(t.h).send({ name: 'Senior Engineer' })).body.data;
    await Employee.update({ designationId: designation.id }, { where: { id: t.asha.employee.id }, ...RAW });
    expect((await ctx.http().patch(`${API}/employees/${t.asha.employee.id}`).set(t.h).send({ personalEmail: 'asha.home@example.test' })).status).toBe(200);
    const id = (await ctx.http().post(`${API}/exits/resign`).set(t.asha.h).send({ reason: 'RELOCATION' })).body.data.id;
    const accepted = (await ctx.http().post(`${API}/exits/${id}/approve`).set(t.mgr.h).send({ lastWorkingDay: days(0) })).body.data;
    expect(accepted.permissions.letters).toBe(false);

    // Not before the exit is completed, and the employee can't join the alumni network while still employed.
    expect((await ctx.http().get(`${API}/exits/${id}/letters/draft?type=RELIEVING`).set(t.hr.h)).status).toBe(409);
    expect((await ctx.http().get(`${API}/alumni/me`).set(t.asha.h)).body.data).toMatchObject({ eligible: false, joined: false, profile: { personalEmail: 'asha.home@example.test' } });
    expect((await ctx.http().put(`${API}/alumni/me`).set(t.asha.h).send({ optedIn: true })).status).toBe(409);
    for (const i of accepted.clearanceItems) await ctx.http().patch(`${API}/exits/${id}/clearance/${i.id}`).set(t.hr.h).send({ status: 'CLEARED' });
    expect((await ctx.http().post(`${API}/exits/${id}/complete`).set(t.hr.h).send({})).body.data.permissions.letters).toBe(true);

    // HR starts from the suggested text, edits it and issues the letter; only HR can.
    const draft = (await ctx.http().get(`${API}/exits/${id}/letters/draft?type=RELIEVING`).set(t.hr.h)).body.data;
    expect(draft).toMatchObject({ type: 'RELIEVING', letterDate: days(0), subject: 'Relieving letter', signatoryName: 'Hema Person' });
    expect(draft.body).toContain('relieved of your duties as Senior Engineer in the Engineering department');
    expect((await ctx.http().get(`${API}/exits/${id}/letters/draft?type=RELIEVING`).set(t.mgr.h)).status).toBe(403);
    expect((await ctx.http().post(`${API}/exits/${id}/letters`).set(t.asha.h).send({ ...draft })).status).toBe(403);
    expect((await ctx.http().post(`${API}/exits/${id}/letters`).set(t.hr.h).send({ ...draft, letterDate: days(1) })).status).toBe(422);
    expect((await ctx.http().post(`${API}/exits/${id}/letters`).set(t.hr.h).send({ ...draft, letterDate: '2020-01-01' })).status).toBe(422);
    const issued = await ctx.http().post(`${API}/exits/${id}/letters`).set(t.hr.h).send({ ...draft, body: `${draft.body}\n\nWith best wishes.` });
    expect(issued.status).toBe(201);
    expect(issued.body.data).toMatchObject({ reference: 'REL-0001', issuedBy: 'Hema Person', employee: { name: 'Asha Person' }, letterhead: { name: t.org.organization.name } });
    expect(issued.body.data.body.endsWith('With best wishes.')).toBe(true);
    expect((await ctx.http().post(`${API}/exits/${id}/letters`).set(t.hr.h).send(draft)).status).toBe(409);
    expect(await Notification.count({ where: { userId: t.asha.user.id, type: 'exit.letter' }, ...RAW })).toBe(1);

    // Revoked letters disappear for the employee; a new one gets the next number.
    const letterId = issued.body.data.id;
    expect((await ctx.http().post(`${API}/exits/${id}/letters/${letterId}/revoke`).set(t.hr.h).send({ reason: 'Wrong designation' })).body.data).toMatchObject({ revokedBy: 'Hema Person', revokedReason: 'Wrong designation' });
    expect((await ctx.http().get(`${API}/exits/${id}/letters/${letterId}`).set(t.asha.h)).status).toBe(404);
    const reissued = (await ctx.http().post(`${API}/exits/${id}/letters`).set(t.hr.h).send(draft)).body.data;
    expect(reissued.reference).toBe('REL-0002');
    const experience = (await ctx.http().get(`${API}/exits/${id}/letters/draft?type=EXPERIENCE`).set(t.hr.h)).body.data;
    expect((await ctx.http().post(`${API}/exits/${id}/letters`).set(t.hr.h).send(experience)).body.data.reference).toBe('EXP-0001');
    expect((await ctx.http().get(`${API}/exits/${id}/letters`).set(t.hr.h)).body.data).toHaveLength(3);
    const mine = (await ctx.http().get(`${API}/exits/${id}/letters`).set(t.asha.h)).body.data as { reference: string }[];
    expect(mine.map((l) => l.reference).sort()).toEqual(['EXP-0001', 'REL-0002']);
    expect((await ctx.http().get(`${API}/exits/${id}/letters/${reissued.id}`).set(t.asha.h)).body.data.body).toContain('Dear Asha Person');
    expect((await ctx.http().get(`${API}/exits/${id}/letters`).set(t.ben.h)).status).toBe(404);

    // Alumni: contact details are visible to HR only while opted in.
    let directory = (await ctx.http().get(`${API}/alumni`).set(t.hr.h)).body.data;
    expect(directory).toEqual([expect.objectContaining({ id: t.asha.employee.id, optedIn: false, alumni: null, exit: expect.objectContaining({ id, type: 'RESIGNATION', eligibleForRehire: null }) })]);
    expect((await ctx.http().put(`${API}/alumni/me`).set(t.asha.h).send({ optedIn: true, personalEmail: 'not-an-email' })).status).toBe(422);
    const joined = await ctx.http().put(`${API}/alumni/me`).set(t.asha.h).send({ optedIn: true, personalEmail: 'Asha.Home@Example.test', currentCompany: 'Globex', currentTitle: 'Staff Engineer', linkedinUrl: 'https://linkedin.com/in/asha', openToOpportunities: true });
    expect(joined.body.data).toMatchObject({ eligible: true, joined: true, profile: { optedIn: true, personalEmail: 'asha.home@example.test', currentCompany: 'Globex', openToOpportunities: true } });
    await ctx.http().patch(`${API}/exits/${id}`).set(t.hr.h).send({ eligibleForRehire: true });
    directory = (await ctx.http().get(`${API}/alumni?openToOpportunities=true&rehire=yes`).set(t.hr.h)).body.data;
    expect(directory).toEqual([expect.objectContaining({ optedIn: true, alumni: expect.objectContaining({ currentCompany: 'Globex', personalEmail: 'asha.home@example.test' }), exit: expect.objectContaining({ eligibleForRehire: true }) })]);
    expect((await ctx.http().get(`${API}/alumni?rehire=no`).set(t.hr.h)).body.data).toEqual([]);
    // The department manager sees alumni from their department without rehire decisions; others see nobody.
    expect((await ctx.http().get(`${API}/alumni`).set(t.mgr.h)).body.data).toEqual([expect.objectContaining({ id: t.asha.employee.id, exit: expect.not.objectContaining({ eligibleForRehire: expect.anything() }) })]);
    expect((await ctx.http().get(`${API}/alumni`).set(t.ben.h)).status).toBe(403);
    await ctx.http().put(`${API}/alumni/me`).set(t.asha.h).send({ optedIn: false, openToOpportunities: true });
    directory = (await ctx.http().get(`${API}/alumni`).set(t.hr.h)).body.data;
    expect(directory[0]).toMatchObject({ optedIn: false, alumni: null });
    expect((await ctx.http().get(`${API}/alumni?optedIn=true`).set(t.hr.h)).body.data).toEqual([]);

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/exits/${id}/letters/${reissued.id}`).set(oh)).status).toBe(404);
    expect((await ctx.http().get(`${API}/alumni`).set(oh)).body.data).toEqual([]);
  });
});
