import { AuditLog, Candidate, Employee, EmployeeFamilyMember, User } from '../src/database/models';
import { API, PASSWORD, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday, resetDatabase, uniqueEmail } from './helpers';

describe('Privacy: data export, erasure and retention (e2e)', () => {
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

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const user = await createUser(ctx, { email: uniqueEmail('asha'), firstName: 'Asha', lastName: 'Rao' });
    const membership = await addMember(ctx, org.organization.id, user.id, ['employee']);
    const employee = (
      await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2020-01-06', membershipId: membership.id, phone: '+91 98450 11111', address: '4 Residency Road' })
    ).body.data;
    expect((await ctx.http().put(`${API}/employees/${employee.id}/sensitive`).set(h).send({ pan: 'ABCDE1234F', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' })).status).toBe(200);
    expect((await ctx.http().post(`${API}/employees/${employee.id}/family`).set(h).send({ name: 'Ravi Rao', relationship: 'SPOUSE' })).status).toBe(201);
    const me = bearer((await login(ctx, user.email)).accessToken);
    return { ...org, h, user, employee, me };
  }
  const stepUp = async (h: Record<string, string>) => expect((await ctx.http().post(`${API}/auth/step-up`).set(h).send({ password: PASSWORD })).status).toBe(200);

  it('lets people download their own data after re-confirming their identity', async () => {
    const s = await setup();
    const blocked = await ctx.http().get(`${API}/privacy/me/export`).set(s.me);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('STEP_UP_REQUIRED');
    await stepUp(s.me);
    const res = await ctx.http().get(`${API}/privacy/me/export`).set(s.me).buffer(true).parse((r, cb) => {
      let body = '';
      r.on('data', (c: Buffer) => (body += c.toString()));
      r.on('end', () => cb(null, body));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/my-data-\d{4}-\d{2}-\d{2}\.json/);
    const data = JSON.parse(res.body as string);
    expect(data.account).toMatchObject({ email: s.user.email });
    expect(data.employee).toMatchObject({ firstName: 'Asha', address: '4 Residency Road', pan: 'ABCDE1234F', bankAccountNumber: '123456789012' });
    expect(data.family).toEqual([expect.objectContaining({ name: 'Ravi Rao' })]);
    // No ciphertext, storage keys or hashes in the file.
    expect(res.body).not.toMatch(/"k1:|Encrypted"|storageKey|passwordHash/);
    expect(await AuditLog.count({ where: { action: 'privacy.exported', organizationId: s.organization.id }, ...RAW })).toBe(1);
  });

  it('erases former employees: statutory records kept within retention, anonymized after it', async () => {
    const s = await setup();
    const erase = (confirm: string) => ctx.http().post(`${API}/privacy/employees/${s.employee.id}/erase`).set(s.h).send({ confirm });
    await stepUp(s.h);
    expect((await erase(s.employee.employeeCode)).status).toBe(409); // still employed
    const exit = await ctx.http().post(`${API}/employees/${s.employee.id}/lifecycle`).set(s.h).send({ type: 'STATUS_CHANGE', status: 'EXITED', effectiveDate: orgToday() });
    expect(exit.status).toBe(201);
    expect((await erase('WRONG')).status).toBe(422);

    const partial = await erase(s.employee.employeeCode);
    expect(partial.status).toBe(201);
    expect(partial.body.data.erasureLevel).toBe('PARTIAL');
    let row = (await Employee.findByPk(s.employee.id, RAW))!;
    expect(row).toMatchObject({ firstName: 'Asha', phone: null, address: null, bankAccountEncrypted: null, erasureLevel: 'PARTIAL' });
    expect(row.panEncrypted).not.toBeNull();
    expect(await EmployeeFamilyMember.count({ where: { employeeId: s.employee.id }, ...RAW })).toBe(0);
    // Signed out and the account anonymized (no other organization).
    expect((await ctx.http().get(`${API}/auth/me`).set(s.me)).status).toBe(401);
    expect((await User.findByPk(s.user.id))!).toMatchObject({ status: 'DISABLED', email: `erased-${s.user.id}@erased.invalid`, firstName: 'Former' });
    expect((await ctx.http().post(`${API}/auth/login`).send({ email: s.user.email, password: PASSWORD })).status).toBe(401);
    expect((await erase(s.employee.employeeCode)).status).toBe(409);

    const overview = (await ctx.http().get(`${API}/privacy`).set(s.h)).body.data;
    expect(overview.formerEmployees).toEqual([expect.objectContaining({ id: s.employee.id, erasureLevel: 'PARTIAL', nextErasure: 'PARTIAL' })]);

    // Past the retention period: anonymized.
    await Employee.update({ dateOfJoining: '2010-01-04', exitDate: '2012-03-31' }, { where: { id: s.employee.id }, ...RAW });
    const full = await erase(s.employee.employeeCode);
    expect(full.body.data.erasureLevel).toBe('FULL');
    row = (await Employee.findByPk(s.employee.id, RAW))!;
    expect(row).toMatchObject({ firstName: 'Former', lastName: 'employee', panEncrypted: null, erasureLevel: 'FULL' });
    expect((await ctx.http().get(`${API}/privacy`).set(s.h)).body.data.formerEmployees).toEqual([]);
  });

  it('anonymizes candidates who were not hired after the retention period', async () => {
    const s = await setup();
    const old = await Candidate.create({ organizationId: s.organization.id, firstName: 'Old', lastName: 'Applicant', email: 'old@example.test', phone: '+91 90000 00000', notes: 'Strong in SQL' }, RAW);
    const recent = await Candidate.create({ organizationId: s.organization.id, firstName: 'Recent', lastName: 'Applicant', email: 'recent@example.test' }, RAW);
    await ctx.db.sequelize.query(`UPDATE candidates SET updated_at = now() - interval '2 years' WHERE id = :id`, { replacements: { id: old.id } });

    expect((await ctx.http().put(`${API}/privacy/settings`).set(s.h).send({ candidateRetentionMonths: 6 })).status).toBe(200);
    expect((await ctx.http().get(`${API}/privacy`).set(s.h)).body.data).toMatchObject({ candidateRetentionMonths: 6, candidatesDue: 1 });
    const res = await ctx.http().post(`${API}/privacy/candidates/purge`).set(s.h).send({});
    expect(res.body.data.anonymized).toBe(1);
    const erased = (await Candidate.findByPk(old.id, RAW))!;
    expect(erased).toMatchObject({ firstName: 'Former', lastName: 'candidate', phone: null, notes: null, email: `erased-${old.id}@erased.invalid` });
    expect(erased.erasedAt).not.toBeNull();
    expect((await Candidate.findByPk(recent.id, RAW))!.firstName).toBe('Recent');
    expect((await ctx.http().post(`${API}/privacy/candidates/purge`).set(s.h).send({})).body.data.anonymized).toBe(0);
    // Employees can't use the privacy console.
    expect((await ctx.http().get(`${API}/privacy`).set(s.me)).status).toBe(403);
  });
});
