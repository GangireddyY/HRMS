import { AuditLog } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Custom employee fields (e2e)', () => {
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

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  it('defines typed fields that HR and employees fill in within their rights', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager']);
    const manager = await person(org.organization.id, h, ['department_manager'], { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });

    const define = (body: Record<string, unknown>, who = hr.h) => ctx.http().post(`${API}/custom-fields`).set(who).send(body);
    expect((await define({ key: 'x', label: 'X', type: 'TEXT' }, asha.h)).status).toBe(403);
    expect((await define({ key: 'Bad Key', label: 'Bad', type: 'TEXT' })).status).toBe(422);
    expect((await define({ key: 'shirt', label: 'T-shirt size', type: 'SELECT' })).status).toBe(422);
    expect((await define({ key: 'shirt', label: 'T-shirt size', type: 'SELECT', options: ['S', 'M', 'L'], employeeEditable: true, section: 'Swag' })).status).toBe(201);
    expect((await define({ key: 'shirt', label: 'Shirt again', type: 'TEXT' })).status).toBe(422);
    await define({ key: 'blood_donor', label: 'Blood donor', type: 'BOOLEAN', employeeEditable: true });
    await define({ key: 'badge_number', label: 'Badge number', type: 'TEXT', required: true });
    await define({ key: 'medical_notes', label: 'Medical notes', type: 'LONG_TEXT', sensitive: true });
    const langs = (await define({ key: 'languages', label: 'Languages', type: 'MULTI_SELECT', options: ['English', 'Hindi', 'Kannada'] })).body.data;
    expect((await ctx.http().get(`${API}/custom-fields`).set(asha.h)).body.data.map((d: { key: string }) => d.key)).toEqual(['shirt', 'blood_donor', 'badge_number', 'medical_notes', 'languages']);

    // HR fills them in; values are checked against their type.
    const url = `${API}/employees/${asha.employee.id}/custom-fields`;
    expect((await ctx.http().put(url).set(hr.h).send({ values: { shirt: 'XL' } })).body.error.details[0].message).toMatch(/choose one of S, M, L/);
    expect((await ctx.http().put(url).set(hr.h).send({ values: { languages: ['English', 'French'] } })).status).toBe(422);
    expect((await ctx.http().put(url).set(hr.h).send({ values: { nope: 1 } })).status).toBe(422);
    const saved = (await ctx.http().put(url).set(hr.h).send({ values: { badge_number: ' B-12 ', shirt: 'M', medical_notes: 'Asthma inhaler', languages: ['English', 'Kannada'] } })).body.data;
    type Field = { key: string; value: unknown; editable: boolean; hidden: boolean };
    const value = (list: Field[], key: string) => list.find((f) => f.key === key)!;
    expect(value(saved, 'badge_number')).toMatchObject({ value: 'B-12', editable: true });
    expect(value(saved, 'languages').value).toEqual(['English', 'Kannada']);
    expect((await ctx.http().put(url).set(hr.h).send({ values: { badge_number: '' } })).status).toBe(422);

    // The employee sees all their own fields and edits only theirs.
    const mine = (await ctx.http().get(`${API}/employees/me/custom-fields`).set(asha.h)).body.data;
    expect(value(mine, 'medical_notes')).toMatchObject({ value: 'Asthma inhaler', hidden: false, editable: false });
    expect(value(mine, 'shirt').editable).toBe(true);
    const updated = (await ctx.http().put(`${API}/employees/me/custom-fields`).set(asha.h).send({ values: { shirt: 'L', blood_donor: 'yes' } })).body.data;
    expect([value(updated, 'shirt').value, value(updated, 'blood_donor').value]).toEqual(['L', true]);
    expect((await ctx.http().put(`${API}/employees/me/custom-fields`).set(asha.h).send({ values: { badge_number: 'B-99' } })).status).toBe(403);

    // The manager sees the employee's fields but not sensitive values, and can't change them.
    const seen = (await ctx.http().get(url).set(manager.h)).body.data;
    expect(value(seen, 'medical_notes')).toMatchObject({ value: null, hidden: true, editable: false });
    expect(value(seen, 'badge_number').value).toBe('B-12');
    expect((await ctx.http().put(url).set(manager.h).send({ values: { shirt: 'S' } })).status).toBe(403);

    // Sensitive changes are audited without their values.
    await ctx.http().put(url).set(hr.h).send({ values: { medical_notes: 'No restrictions' } });
    const audit = await AuditLog.findAll({ where: { action: 'employee.custom_fields_updated', entityId: asha.employee.id }, order: [['createdAt', 'DESC']], ...RAW });
    expect(audit[0]!.changes).toEqual({ medical_notes: { from: '[REDACTED]', to: '[REDACTED]' } });

    // Archived fields disappear from profiles; their values are kept.
    await ctx.http().patch(`${API}/custom-fields/${langs.id}`).set(hr.h).send({ archived: true });
    expect((await ctx.http().get(url).set(hr.h)).body.data.map((f: { key: string }) => f.key)).not.toContain('languages');
    expect((await ctx.http().get(`${API}/custom-fields?archived=true`).set(hr.h)).body.data.find((d: { key: string }) => d.key === 'languages').archived).toBe(true);
    await ctx.http().patch(`${API}/custom-fields/${langs.id}`).set(hr.h).send({ archived: false });
    expect(value((await ctx.http().get(url).set(hr.h)).body.data, 'languages').value).toEqual(['English', 'Kannada']);
  });
});
