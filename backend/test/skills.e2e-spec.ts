import { EmployeeSkill } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Skill matrix (e2e)', () => {
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

  it('keeps a skills catalog, role needs, self ratings, verification, course skills and the matrix', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const ops = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Operations' })).body.data;
    const engineer = (await ctx.http().post(`${API}/designations`).set(h).send({ name: 'Engineer' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema', { departmentId: ops.id });
    const mgr = await person(org.organization.id, h, ['department_manager'], 'Manoj', { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { departmentId: eng.id, designationId: engineer.id, managerId: mgr.employee.id });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { departmentId: ops.id });

    // Catalog (HR only), names unique.
    const skill = async (name: string, category: string) => (await ctx.http().post(`${API}/skills`).set(hr.h).send({ name, category })).body.data.id as string;
    const ts = await skill('TypeScript', 'TECHNICAL');
    const sql = await skill('SQL', 'TECHNICAL');
    const talk = await skill('Communication', 'SOFT');
    expect((await ctx.http().post(`${API}/skills`).set(hr.h).send({ name: 'typescript', category: 'TOOL' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/skills`).set(asha.h).send({ name: 'Go', category: 'TECHNICAL' })).status).toBe(403);
    expect((await ctx.http().get(`${API}/skills`).set(asha.h)).body.data.map((s: { name: string }) => s.name)).toEqual(['Communication', 'SQL', 'TypeScript']);

    // What an engineer needs.
    expect((await ctx.http().put(`${API}/skills/requirements/${engineer.id}`).set(hr.h).send({ skills: [{ skillId: ts, level: 4 }, { skillId: ts, level: 2 }] })).status).toBe(422);
    const needs = await ctx.http().put(`${API}/skills/requirements/${engineer.id}`).set(hr.h).send({ skills: [{ skillId: ts, level: 4 }, { skillId: sql, level: 3 }] });
    expect(needs.body.data.skills.map((s: { name: string; requiredLevel: number }) => [s.name, s.requiredLevel])).toEqual([['SQL', 3], ['TypeScript', 4]]);

    // Asha rates herself.
    let mine = (await ctx.http().get(`${API}/skills/me/profile`).set(asha.h)).body.data;
    expect(mine).toMatchObject({ designation: { name: 'Engineer' }, readiness: 0, skills: [] });
    expect(mine.gaps.map((g: { name: string; gap: number }) => [g.name, g.gap])).toEqual([['TypeScript', 4], ['SQL', 3]]);
    await ctx.http().put(`${API}/skills/me/profile`).set(asha.h).send({ skillId: ts, level: 3 });
    await ctx.http().put(`${API}/skills/me/profile`).set(asha.h).send({ skillId: talk, level: 4, notes: 'Run the team demos' });
    mine = (await ctx.http().put(`${API}/skills/me/profile`).set(asha.h).send({ skillId: sql, level: 3 })).body.data;
    expect(mine).toMatchObject({ readiness: 50, gaps: [{ name: 'TypeScript', current: 3, gap: 1, courses: [] }] });

    // A course that teaches TypeScript to level 4 shows up as the way to close the gap.
    const course = (await ctx.http().post(`${API}/training/courses`).set(hr.h).send({ code: 'TS-201', title: 'Advanced TypeScript', category: 'TECHNICAL', delivery: 'SELF_PACED', contentUrl: 'https://learn.example.com/ts', selfEnrollment: true })).body.data;
    expect((await ctx.http().put(`${API}/skills/courses/${course.id}`).set(hr.h).send({ skills: [{ skillId: ts, level: 4 }] })).body.data).toEqual([expect.objectContaining({ name: 'TypeScript', level: 4 })]);
    expect((await ctx.http().get(`${API}/skills/me/profile`).set(asha.h)).body.data.gaps[0].courses).toEqual([]);
    await ctx.http().post(`${API}/training/courses/${course.id}/publish`).set(hr.h).send({});
    expect((await ctx.http().get(`${API}/skills/me/profile`).set(asha.h)).body.data.gaps[0].courses).toEqual([expect.objectContaining({ code: 'TS-201', teachesLevel: 4 })]);

    // Her manager verifies SQL lower than she rated it; others outside the department can't, nor can she.
    expect((await ctx.http().post(`${API}/skills/employees/${asha.employee.id}/${sql}/verify`).set(asha.h).send({ level: 5 })).status).toBe(403);
    expect((await ctx.http().post(`${API}/skills/employees/${asha.employee.id}/${sql}/verify`).set(ben.h).send({ level: 5 })).status).toBe(403);
    expect((await ctx.http().post(`${API}/skills/employees/${mgr.employee.id}/${sql}/verify`).set(mgr.h).send({ level: 5 })).status).toBe(403);
    const verified = (await ctx.http().post(`${API}/skills/employees/${asha.employee.id}/${sql}/verify`).set(mgr.h).send({ level: 2 })).body.data;
    expect(verified.skills.find((s: { name: string }) => s.name === 'SQL')).toMatchObject({ level: 3, verifiedLevel: 2, verifiedSource: 'MANAGER', verifiedBy: 'Manoj Person', effectiveLevel: 2 });
    expect(verified.readiness).toBe(0);
    expect((await ctx.http().get(`${API}/skills/employees/${ben.employee.id}`).set(mgr.h)).status).toBe(404);

    // Completing the course verifies TypeScript at level 4.
    const enrolment = (await ctx.http().post(`${API}/training/courses/${course.id}/enroll`).set(asha.h).send({})).body.data;
    await ctx.http().post(`${API}/training/enrollments/${enrolment.id}/start`).set(asha.h).send({});
    expect((await ctx.http().post(`${API}/training/enrollments/${enrolment.id}/done`).set(asha.h).send({})).body.data.status).toBe('COMPLETED');
    expect(await EmployeeSkill.findOne({ where: { employeeId: asha.employee.id, skillId: ts }, ...RAW })).toMatchObject({ level: 3, verifiedLevel: 4, verifiedSource: 'TRAINING' });
    mine = (await ctx.http().get(`${API}/skills/me/profile`).set(asha.h)).body.data;
    expect(mine).toMatchObject({ readiness: 50, gaps: [{ name: 'SQL', current: 2, gap: 1 }] });

    // The matrix: engineers against what the role needs.
    const matrix = (await ctx.http().get(`${API}/skills/matrix/view?designationId=${engineer.id}`).set(mgr.h)).body.data;
    expect(matrix.skills.map((s: { name: string }) => s.name).sort()).toEqual(['SQL', 'TypeScript']);
    const row = matrix.page.items.find((r: { employee: { name: string } }) => r.employee.name === 'Asha Person');
    const cell = (id: string) => row.cells.find((c: { skillId: string }) => c.skillId === id);
    expect(cell(ts)).toMatchObject({ level: 4, required: 4, gap: 0 });
    expect(cell(sql)).toMatchObject({ level: 2, selfLevel: 3, verifiedLevel: 2, required: 3, gap: 1 });
    expect((await ctx.http().get(`${API}/skills/matrix/view`).set(ben.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/skills/matrix/view`).set(hr.h)).body.data.skills.length).toBe(3);

    // Skills in use are deactivated rather than deleted; removing a self rating keeps a verified level.
    expect((await ctx.http().delete(`${API}/skills/${sql}`).set(hr.h)).status).toBe(409);
    await ctx.http().delete(`${API}/skills/me/profile/${sql}`).set(asha.h);
    expect(await EmployeeSkill.findOne({ where: { employeeId: asha.employee.id, skillId: sql }, ...RAW })).toMatchObject({ level: null, verifiedLevel: 2 });
    expect((await ctx.http().patch(`${API}/skills/${sql}`).set(hr.h).send({ isActive: false })).body.data.isActive).toBe(false);

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/skills`).set(oh)).body.data).toEqual([]);
    expect((await ctx.http().get(`${API}/skills/employees/${asha.employee.id}`).set(oh)).status).toBe(404);
  });
});
