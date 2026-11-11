import { AuditLog } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Bulk imports per module (e2e)', () => {
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
    async function person(roleKeys: string[]) {
      const user = await createUser(ctx, { email: uniqueEmail('p'), lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roleKeys);
      const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id });
      expect(res.status).toBe(201);
      return { user, employee: res.body.data as { id: string; employeeCode: string }, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    return { ...org, h, person };
  }
  const csv = (...lines: string[]) => Buffer.from(lines.join('\r\n'), 'utf8');
  const upload = (h: Record<string, string>, key: string, file: Buffer, dryRun = false) =>
    ctx
      .http()
      .post(`${API}/imports/${key}${dryRun ? '?dryRun=true' : ''}`)
      .set(h)
      .attach('file', file, 'import.csv');

  it('lists imports by permission and serves templates', async () => {
    const s = await setup();
    const hr = await s.person(['hr_manager']);
    const asha = await s.person(['employee']);
    const keys = async (h: Record<string, string>) => (await ctx.http().get(`${API}/imports`).set(h)).body.data.map((i: { key: string }) => i.key);
    expect(await keys(s.h)).toEqual(['leave-balances', 'salaries', 'assets', 'custom-fields']);
    expect(await keys(hr.h)).toEqual(expect.arrayContaining(['leave-balances', 'custom-fields']));
    expect(await keys(asha.h)).toEqual([]);
    expect((await upload(asha.h, 'leave-balances', csv('employee_code,leave_type,days'))).status).toBe(403);
    expect((await ctx.http().get(`${API}/imports/nope/template`).set(s.h)).status).toBe(404);

    await ctx.http().post(`${API}/custom-fields`).set(s.h).send({ key: 'shirt', label: 'T-shirt size', type: 'SELECT', options: ['S', 'M'] });
    const template = await ctx.http().get(`${API}/imports/custom-fields/template`).set(s.h);
    expect(template.status).toBe(200);
    expect(template.headers['content-type']).toContain('text/csv');
    expect(template.text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('employee_code,shirt');
  });

  it('checks the whole file before applying leave balances', async () => {
    const s = await setup();
    const created = await ctx.http().post(`${API}/leave/types`).set(s.h).send({ code: 'EL', name: 'Earned leave', annualQuota: 0, accrualFrequency: 'NONE' });
    expect(created.status).toBe(201);
    const asha = await s.person(['employee']);
    const ravi = await s.person(['employee']);
    const code = (p: { employee: { employeeCode: string } }) => p.employee.employeeCode;

    const missing = await upload(s.h, 'leave-balances', csv('employee_code,days', `${code(asha)},5`));
    expect(missing.status).toBe(422);
    expect(missing.body.error.details[0].message).toBe('Missing required column: leave_type');

    const bad = csv('Employee Code,Leave Type,Days,Kind,Extra', `${code(asha)},EL,5,,x`, `${code(ravi)},Earned leave,2.3,`, 'EMP-9999,EL,1,', `${code(ravi)},XX,-1,GRANT`, ',,,');
    const checked = (await upload(s.h, 'leave-balances', bad)).body.data;
    expect(checked).toMatchObject({ total: 4, valid: 1, invalid: 3, applied: 0, ignoredColumns: ['Extra'] });
    expect(checked.issues).toEqual([
      { row: 3, column: 'days', message: 'Use whole or half days (not zero)' },
      { row: 4, column: 'employee_code', message: 'No employee with code EMP-9999' },
      { row: 5, column: 'leave_type', message: 'No leave type "XX"' },
      { row: 5, column: 'days', message: 'A grant adds days; use ADJUSTMENT to reduce' },
    ]);
    const balance = async (p: { h: Record<string, string> }) => (await ctx.http().get(`${API}/leave/balances`).set(p.h)).body.data.balances.find((b: { leaveType: { code: string } }) => b.leaveType.code === 'EL')?.balance;
    expect(await balance(asha)).toBe(0);

    const good = csv('employee_code,leave_type,days,kind,note', `${code(asha)},EL,5,,Opening balance`, `${code(ravi).toLowerCase()},earned leave,2.5,ADJUSTMENT,`);
    expect((await upload(s.h, 'leave-balances', good, true)).body.data).toMatchObject({ dryRun: true, valid: 2, applied: 0 });
    expect(await balance(asha)).toBe(0);
    expect((await upload(s.h, 'leave-balances', good)).body.data).toMatchObject({ dryRun: false, total: 2, applied: 2, failed: 0, issues: [] });
    expect([await balance(asha), await balance(ravi)]).toEqual([5, 2.5]);
    expect(await AuditLog.count({ where: { action: 'imports.completed' }, ...RAW })).toBe(1);
  });

  it('imports salaries, assets with hand-over, and custom field values', async () => {
    const s = await setup();
    const asha = await s.person(['employee']);
    const code = asha.employee.employeeCode;
    await ctx.http().post(`${API}/payroll/structures/recommended`).set(s.h).send({});

    // Salaries: the only active structure is the default; a named one must exist.
    const invalid = (await upload(s.h, 'salaries', csv('employee_code,annual_ctc,effective_from,structure', `${code},"9,00,000",2026-04-31,`, `${code},abc,2026-04-01,Executive`))).body.data;
    expect(invalid.issues.map((i: { row: number; column: string }) => `${i.row}:${i.column}`)).toEqual(['2:effective_from', '3:structure', '3:annual_ctc']);
    const salaries = (await upload(s.h, 'salaries', csv('employee_code,annual_ctc,effective_from,structure,pf_applicable', `${code},"9,00,000",2026-04-01,standard,yes`))).body.data;
    expect(salaries).toMatchObject({ applied: 1, failed: 0 });
    const history = (await ctx.http().get(`${API}/payroll/employees/${asha.employee.id}/salaries`).set(s.h)).body.data;
    expect(history.salaries[0]).toMatchObject({ annualCtc: 900000, effectiveFrom: '2026-04-01' });

    // Assets, one handed to Asha; duplicate tags in the file are caught up front.
    const dupes = (await upload(s.h, 'assets', csv('name,category,tag', 'Laptop,laptop,LT-1', 'Laptop 2,LAPTOP,lt-1', 'Desk,TABLE,'))).body.data;
    expect(dupes.issues.map((i: { row: number; column: string }) => `${i.row}:${i.column}`)).toEqual(['3:tag', '4:category']);
    const assets = (await upload(s.h, 'assets', csv('name,category,serial_number,purchase_cost,assign_to', 'MacBook Pro,LAPTOP,SN1,"1,85,000",' + code, 'Dell monitor,MONITOR,SN2,22000,'))).body.data;
    expect(assets).toMatchObject({ applied: 2, failed: 0 });
    const register = (await ctx.http().get(`${API}/assets`).set(s.h)).body.data;
    const items = (register.items ?? register) as { name: string; status: string; purchaseCost: number | null }[];
    expect(items.find((a) => a.name === 'MacBook Pro')).toMatchObject({ status: 'ASSIGNED', purchaseCost: 185000 });
    expect(items.find((a) => a.name === 'Dell monitor')!.status).toBe('IN_STOCK');

    // Custom fields: empty cells leave values alone; values are checked against the field type.
    await ctx.http().post(`${API}/custom-fields`).set(s.h).send({ key: 'shirt', label: 'T-shirt size', type: 'SELECT', options: ['S', 'M'] });
    await ctx.http().post(`${API}/custom-fields`).set(s.h).send({ key: 'donor', label: 'Blood donor', type: 'BOOLEAN' });
    const wrong = (await upload(s.h, 'custom-fields', csv('employee_code,shirt,donor', `${code},XL,Y`))).body.data;
    expect(wrong.issues).toEqual([{ row: 2, column: 'shirt', message: 'T-shirt size: choose one of S, M' }]);
    expect((await upload(s.h, 'custom-fields', csv('employee_code,shirt,donor', `${code},M,Y`))).body.data.applied).toBe(1);
    expect((await upload(s.h, 'custom-fields', csv('employee_code,shirt,donor', `${code},,no`))).body.data.applied).toBe(1);
    const values = (await ctx.http().get(`${API}/employees/${asha.employee.id}/custom-fields`).set(s.h)).body.data as { key: string; value: unknown }[];
    expect(Object.fromEntries(values.map((v) => [v.key, v.value]))).toEqual({ shirt: 'M', donor: false });
  });
});
