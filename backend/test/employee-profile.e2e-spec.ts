import { createCipheriv, randomBytes } from 'node:crypto';
import { AuditLog, Employee, EmployeeDocument, Notification } from '../src/database/models';
import { reencryptAll } from '../src/database/reencrypt';
import { EncryptionService } from '../src/infrastructure/crypto/encryption.service';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('Employee profile, documents, import and hierarchy (e2e)', () => {
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

  async function adminSession() {
    const org = await createOrgWithAdmin(ctx);
    const s = await login(ctx, org.admin.email);
    return { ...org, h: bearer(s.accessToken) };
  }

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2025-01-06', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  it('changes a salary bank account only after a second person approves (maker-checker)', async () => {
    const { organization, h } = await adminSession();
    const asha = await person(organization.id, h, ['employee'], { workEmail: 'asha.bank@example.test' });
    const second = await person(organization.id, h, ['org_admin']);
    const url = `${API}/employees/${asha.employee.id}/sensitive`;

    // The first account is applied directly; the employee is told.
    const first = await ctx.http().put(url).set(h).send({ bankAccountNumber: '111122223333', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank' });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ bankAccountNumber: '111122223333', pendingBankChange: null });
    expect(ctx.mail.outbox.some((m) => m.to === 'asha.bank@example.test' && m.text.includes('ending 3333'))).toBe(true);

    // Replacing it creates a request; payroll keeps the current account.
    const change = await ctx.http().put(url).set(h).send({ bankAccountNumber: '999988887777', bankIfsc: 'ICIC0004321', bankName: 'ICICI Bank', pan: 'ABCDE1234F' });
    expect(change.status).toBe(200);
    expect(change.body.data).toMatchObject({ bankAccountNumber: '111122223333', pan: 'ABCDE1234F', pendingBankChange: { accountLast4: '7777', ifsc: 'ICIC0004321', canReview: false } });
    const changeId = change.body.data.pendingBankChange.id;

    // Neither the requester nor the employee can approve it.
    expect((await ctx.http().post(`${API}/employees/bank-changes/${changeId}/approve`).set(h)).status).toBe(403);
    expect((await ctx.http().post(`${API}/employees/bank-changes/${changeId}/approve`).set(asha.h)).status).toBe(403);

    const queue = await ctx.http().get(`${API}/employees/bank-changes`).set(second.h);
    expect(queue.body.data).toEqual([expect.objectContaining({ id: changeId, accountLast4: '7777', canReview: true })]);
    expect((await ctx.http().post(`${API}/employees/bank-changes/${changeId}/approve`).set(second.h)).status).toBe(201);
    const after = await ctx.http().get(url).set(h);
    expect(after.body.data).toMatchObject({ bankAccountNumber: '999988887777', bankIfsc: 'ICIC0004321', pendingBankChange: null });
    const actions = (await AuditLog.findAll({ where: { entityId: asha.employee.id }, ...RAW })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['employee.bank_change_requested', 'employee.bank_change_approved']));
    expect(ctx.mail.outbox.some((m) => m.to === 'asha.bank@example.test' && m.text.includes('changed to one ending 7777'))).toBe(true);
  });

  it('manages grades and cost centers and records them through lifecycle actions', async () => {
    const { h } = await adminSession();
    const l2 = (await ctx.http().post(`${API}/grades`).set(h).send({ name: 'L2', code: 'l2', level: 2 })).body.data;
    const l3 = (await ctx.http().post(`${API}/grades`).set(h).send({ name: 'L3', level: 3 })).body.data;
    expect(l2.code).toBe('L2');
    expect((await ctx.http().post(`${API}/grades`).set(h).send({ name: 'l2' })).status).toBe(422);
    const cc = await ctx.http().post(`${API}/cost-centers`).set(h).send({ name: 'Engineering R&D', code: 'cc-100' });
    expect(cc.body.data.code).toBe('CC-100');
    expect((await ctx.http().post(`${API}/cost-centers`).set(h).send({ name: 'Other', code: 'CC-100' })).status).toBe(422);
    const cc2 = (await ctx.http().post(`${API}/cost-centers`).set(h).send({ name: 'Sales', code: 'CC-200' })).body.data;

    const e = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2024-01-15', gradeId: l2.id, costCenterId: cc.body.data.id, bloodGroup: 'O+', maritalStatus: 'MARRIED', nationality: 'in', noticePeriodDays: 60 })).body.data;
    expect(e).toMatchObject({ grade: { name: 'L2' }, costCenter: { code: 'CC-100' }, bloodGroup: 'O+', nationality: 'IN', noticePeriodDays: 60 });
    // Grade and cost center change only through lifecycle actions.
    expect((await ctx.http().patch(`${API}/employees/${e.id}`).set(h).send({ gradeId: l3.id })).status).toBe(422);

    const promoted = await ctx.http().post(`${API}/employees/${e.id}/lifecycle`).set(h).send({ type: 'PROMOTION', effectiveDate: '2025-04-01', gradeId: l3.id });
    expect(promoted.body.data.grade).toMatchObject({ name: 'L3' });
    const moved = await ctx.http().post(`${API}/employees/${e.id}/lifecycle`).set(h).send({ type: 'TRANSFER', effectiveDate: '2025-05-01', costCenterId: cc2.id });
    expect(moved.body.data.costCenter).toMatchObject({ code: 'CC-200' });
    const history = (await ctx.http().get(`${API}/employees/${e.id}/history`).set(h)).body.data;
    expect(history[0].changes.costCenterId).toEqual({ from: 'CC-100 – Engineering R&D', to: 'CC-200 – Sales' });
    expect(history[1].changes.gradeId).toEqual({ from: 'L2', to: 'L3' });

    expect((await ctx.http().delete(`${API}/grades/${l3.id}`).set(h)).status).toBe(409);
    expect((await ctx.http().delete(`${API}/grades/${l2.id}`).set(h)).status).toBe(200);
    expect((await ctx.http().get(`${API}/cost-centers`).set(h)).body.data.find((c: { code: string }) => c.code === 'CC-200').employeeCount).toBe(1);
  });

  it('lets employees maintain their own family, education and experience; HR in scope too', async () => {
    const { organization, h } = await adminSession();
    const lead = await person(organization.id, h, ['team_lead']);
    const me = await person(organization.id, h, ['employee'], { managerId: lead.employee.id, dateOfBirth: '1995-03-01' });
    const other = await person(organization.id, h, ['employee']);

    const spouse = await ctx.http().post(`${API}/employees/${me.employee.id}/family`).set(me.h).send({ name: 'Ravi Rao', relationship: 'SPOUSE', isDependent: true });
    expect(spouse.status).toBe(201);
    expect((await ctx.http().post(`${API}/employees/${me.employee.id}/family`).set(me.h).send({ name: 'Kid', relationship: 'CHILD', dateOfBirth: '2999-01-01' })).status).toBe(422);
    const edu = await ctx.http().post(`${API}/employees/${me.employee.id}/education`).set(me.h).send({ level: 'BACHELORS', qualification: 'B.Tech', institution: 'IIT Madras', startYear: 2013, endYear: 2017, score: '8.4 CGPA' });
    expect(edu.status).toBe(201);
    expect((await ctx.http().post(`${API}/employees/${me.employee.id}/education`).set(me.h).send({ level: 'MASTERS', qualification: 'M.Tech', institution: 'IISc', startYear: 2020, endYear: 2018 })).status).toBe(422);
    const job = await ctx.http().post(`${API}/employees/${me.employee.id}/experience`).set(me.h).send({ company: 'Acme', designation: 'Engineer', startDate: '2018-06-01', endDate: '2024-12-31' });
    expect(job.status).toBe(201);
    // Previous employment must start before joining.
    expect((await ctx.http().post(`${API}/employees/${me.employee.id}/experience`).set(me.h).send({ company: 'Later', designation: 'X', startDate: '2025-02-01', endDate: '2025-03-01' })).status).toBe(422);

    const updated = await ctx.http().patch(`${API}/employees/${me.employee.id}/family/${spouse.body.data.id}`).set(me.h).send({ phone: '+91 90000 00000' });
    expect(updated.body.data).toMatchObject({ name: 'Ravi Rao', phone: '+91 90000 00000' });

    // The team lead can see the report's profile but cannot change it (no employee.update).
    expect((await ctx.http().get(`${API}/employees/${me.employee.id}/education`).set(lead.h)).body.data).toHaveLength(1);
    expect((await ctx.http().post(`${API}/employees/${me.employee.id}/family`).set(lead.h).send({ name: 'X', relationship: 'OTHER' })).status).toBe(403);
    // Another employee cannot even see it.
    expect((await ctx.http().get(`${API}/employees/${me.employee.id}/family`).set(other.h)).status).toBe(404);
    // HR (admin) can edit.
    expect((await ctx.http().delete(`${API}/employees/${me.employee.id}/experience/${job.body.data.id}`).set(h)).status).toBe(200);

    // Self-service profile fields.
    const self = await ctx.http().patch(`${API}/employees/me`).set(me.h).send({ bloodGroup: 'B+', maritalStatus: 'MARRIED', permanentAddress: '12 MG Road, Bengaluru' });
    expect(self.body.data).toMatchObject({ bloodGroup: 'B+', maritalStatus: 'MARRIED', permanentAddress: '12 MG Road, Bengaluru' });
    expect((await ctx.http().patch(`${API}/employees/me`).set(me.h).send({ noticePeriodDays: 0 })).status).toBe(422);
  });

  it('stores identity numbers encrypted', async () => {
    const { h } = await adminSession();
    const e = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2025-02-03' })).body.data;
    expect((await ctx.http().put(`${API}/employees/${e.id}/sensitive`).set(h).send({ aadhaar: '1234 5678 9012' })).status).toBe(422);
    expect((await ctx.http().put(`${API}/employees/${e.id}/sensitive`).set(h).send({ passportExpiry: '2031-01-01' })).status).toBe(422);
    const saved = await ctx.http().put(`${API}/employees/${e.id}/sensitive`).set(h).send({ aadhaar: '2345 6789 0123', passportNumber: 'z1234567', passportExpiry: '2031-01-01' });
    expect(saved.body.data).toMatchObject({ aadhaar: '234567890123', passportNumber: 'Z1234567', passportExpiry: '2031-01-01' });
    const row = await Employee.findByPk(e.id, RAW);
    expect(row!.aadhaarEncrypted).toMatch(/^k1:/);
    expect(row!.passportEncrypted).not.toContain('Z1234567');
    expect(row!.aadhaarLast4).toBe('0123');
  });

  it('stores contact details encrypted, bound to the employee', async () => {
    const { h } = await adminSession();
    const contact = { address: '4 Residency Road, Bengaluru', permanentAddress: '9 Temple St, Mysuru', emergencyContactName: 'Meena Rao', emergencyContactPhone: '+91 98450 00000' };
    const e = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Kiran', lastName: 'Rao', dateOfJoining: '2025-02-03', ...contact })).body.data;
    expect(e).toMatchObject(contact);
    const other = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Lata', lastName: 'Iyer', dateOfJoining: '2025-02-03', address: 'Old plain address' })).body.data;
    const row = await Employee.findByPk(e.id, RAW);
    for (const v of [row!.address, row!.permanentAddress, row!.emergencyContactName, row!.emergencyContactPhone]) expect(v).toMatch(/^k1:/);
    expect(row!.address).not.toContain('Residency');
    // Values written before encryption (plain text) still read until the re-encrypt job converts them.
    await Employee.update({ address: 'Legacy plain address' }, { where: { id: other.id }, ...RAW });
    expect((await ctx.http().get(`${API}/employees/${other.id}`).set(h)).body.data.address).toBe('Legacy plain address');
    // Ciphertext moved to another employee's row doesn't decrypt there.
    await Employee.update({ address: row!.address }, { where: { id: other.id }, ...RAW });
    expect((await ctx.http().get(`${API}/employees/${other.id}`).set(h)).status).toBe(500);
    const updated = await ctx.http().patch(`${API}/employees/${other.id}`).set(h).send({ address: 'New Street 5' });
    expect(updated.body.data.address).toBe('New Street 5');
  });

  it('re-encrypts legacy values (earlier format, plain contact details) with the current key and context', async () => {
    const { h } = await adminSession();
    const e = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Old', lastName: 'Record', dateOfJoining: '2025-02-03' })).body.data;
    const crypto = ctx.app.get(EncryptionService);
    // Earlier format: v1, no context.
    const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, 'base64');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update('ABCDE1234F', 'utf8'), c.final()]);
    const legacyPan = ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
    await Employee.update({ panEncrypted: legacyPan, address: 'Plain street 1' }, { where: { id: e.id }, ...RAW });

    const dry = await reencryptAll(ctx.db.sequelize, crypto, { dryRun: true });
    expect(dry.filter((r) => r.rewritten).map((r) => r.field).sort()).toEqual(['employees.address', 'employees.pan_encrypted']);
    expect((await Employee.findByPk(e.id, RAW))!.panEncrypted).toBe(legacyPan);
    const results = await reencryptAll(ctx.db.sequelize, crypto);
    expect(results.every((r) => r.failed === 0)).toBe(true);
    const row = (await Employee.findByPk(e.id, RAW))!;
    expect(row.panEncrypted).toMatch(/^k1:/);
    expect(row.address).toMatch(/^k1:/);
    expect((await ctx.http().get(`${API}/employees/${e.id}/sensitive`).set(h)).body.data.pan).toBe('ABCDE1234F');
    expect((await ctx.http().get(`${API}/employees/${e.id}`).set(h)).body.data.address).toBe('Plain street 1');
    // Nothing left to do on a second run.
    expect((await reencryptAll(ctx.db.sequelize, crypto)).every((r) => r.rewritten === 0)).toBe(true);
  });

  it('uploads, verifies and serves documents with access control', async () => {
    const { organization, h } = await adminSession();
    const me = await person(organization.id, h, ['employee']);
    const other = await person(organization.id, h, ['employee']);
    const url = `${API}/employees/${me.employee.id}/documents`;

    // File type comes from the contents, not the name.
    const fake = await ctx.http().post(url).set(me.h).field('category', 'IDENTITY').field('title', 'PAN card').attach('file', Buffer.from('<html>not a pdf</html>'), 'pan.pdf');
    expect(fake.status).toBe(422);
    expect((await ctx.http().post(url).set(me.h).field('category', 'IDENTITY').field('title', 'PAN card').attach('file', Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf')).status).toBe(422);
    // Malware (the EICAR test signature inside a valid PDF) is blocked before storage, and audited.
    const eicar = Buffer.concat([PDF, Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]);
    const infected = await ctx.http().post(url).set(me.h).field('category', 'IDENTITY').field('title', 'PAN card').attach('file', eicar, 'pan.pdf');
    expect(infected.status).toBe(422);
    expect(infected.body.error.code).toBe('FILE_REJECTED');
    expect(await EmployeeDocument.count({ where: { employeeId: me.employee.id }, ...RAW })).toBe(0);
    expect(await AuditLog.count({ where: { organizationId: organization.id, action: 'security.upload_blocked' }, ...RAW })).toBe(1);

    const mine = await ctx.http().post(url).set(me.h).field('category', 'IDENTITY').field('title', 'PAN card').field('expiryDate', '2020-01-01').attach('file', PDF, '../../etc/pan card.exe');
    expect(mine.status).toBe(201);
    expect(mine.body.data).toMatchObject({ status: 'PENDING', contentType: 'application/pdf', fileName: 'pan card.pdf', byteSize: PDF.length });
    const stored = await EmployeeDocument.findByPk(mine.body.data.id, RAW);
    expect(stored!.storageKey).toBe(`organizations/${organization.id}/employees/${me.employee.id}/documents/${mine.body.data.id}`);

    // Only the employee and HR with document access can see or download.
    expect((await ctx.http().get(url).set(other.h)).status).toBe(404);
    const file = await ctx.http().get(`${url}/${mine.body.data.id}/file`).set(me.h).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

    // The employee cannot verify; HR verifies and the employee is notified.
    expect((await ctx.http().post(`${url}/${mine.body.data.id}/review`).set(me.h).send({ status: 'VERIFIED' })).status).toBe(403);
    expect((await ctx.http().post(`${url}/${mine.body.data.id}/review`).set(h).send({ status: 'REJECTED' })).status).toBe(422);
    const verified = await ctx.http().post(`${url}/${mine.body.data.id}/review`).set(h).send({ status: 'VERIFIED' });
    expect(verified.body.data).toMatchObject({ status: 'VERIFIED', reviewedBy: expect.any(String) });
    expect(await Notification.count({ where: { userId: me.user.id, type: 'employee.document' } })).toBe(1);
    // Verified documents are locked for the employee.
    expect((await ctx.http().delete(`${url}/${mine.body.data.id}`).set(me.h)).status).toBe(403);

    // HR uploads are verified immediately; downloads by HR are audited.
    const hrDoc = await ctx.http().post(url).set(h).field('category', 'OFFER_LETTER').field('title', 'Offer letter').attach('file', PNG, 'offer.png');
    expect(hrDoc.body.data).toMatchObject({ status: 'VERIFIED', contentType: 'image/png' });
    await ctx.http().get(`${url}/${hrDoc.body.data.id}/file`).set(h);
    expect(await AuditLog.count({ where: { organizationId: organization.id, action: 'employee.document_downloaded' }, skipTenantScope: true })).toBe(1);

    const expiring = await ctx.http().get(`${API}/employees/documents/expiring?days=30`).set(h);
    expect(expiring.body.data).toEqual([expect.objectContaining({ title: 'PAN card', expired: true, employee: expect.objectContaining({ id: me.employee.id }) })]);

    expect((await ctx.http().delete(`${url}/${hrDoc.body.data.id}`).set(h)).status).toBe(200);
    expect((await ctx.http().get(`${url}/${hrDoc.body.data.id}/file`).set(h)).status).toBe(404);
    // Deleting the employee removes the remaining documents too.
    expect((await ctx.http().delete(`${API}/employees/${me.employee.id}`).set(h)).status).toBe(200);
    expect(await EmployeeDocument.count({ where: { employeeId: me.employee.id }, skipTenantScope: true })).toBe(0);
  });

  it('imports employees from CSV: validates everything first, then creates all with managers', async () => {
    const { h } = await adminSession();
    await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering', code: 'ENG' });
    await ctx.http().post(`${API}/designations`).set(h).send({ name: 'Engineer' });
    const boss = (await ctx.http().post(`${API}/employees`).set(h).send({ employeeCode: 'B-1', firstName: 'Big', lastName: 'Boss', dateOfJoining: '2020-01-01' })).body.data;

    const template = await ctx.http().get(`${API}/employees/import/template`).set(h);
    expect(template.text).toContain('employee_code,first_name,last_name');

    const bad = ['first_name,last_name,date_of_joining,department,manager_code,gender', 'Asha,Rao,15/01/2024,Marketing,NOPE,robot', ',Rao,2024-01-15,,,'].join('\n');
    const report = await ctx.http().post(`${API}/employees/import`).set(h).attach('file', Buffer.from(bad), 'people.csv');
    expect(report.status).toBe(201);
    expect(report.body.data).toMatchObject({ total: 2, valid: 0, created: 0 });
    const messages = report.body.data.errors.map((e: { row: number; column: string }) => `${e.row}:${e.column}`);
    expect(messages).toEqual(expect.arrayContaining(['2:date_of_joining', '2:department', '2:manager_code', '2:gender', '3:first_name']));
    expect((await ctx.http().get(`${API}/employees`).set(h)).body.meta.total).toBe(1);

    // Managers can be other rows of the same file (listed after their reports) or existing employees.
    const good = [
      'Employee Code,First Name,Last Name,Work Email,Date of Joining,Department,Designation,Manager Code,Employment Type,Status',
      'E-2,Ravi,Kumar,ravi@example.com,2024-03-01,eng,Engineer,E-1,full time,ACTIVE',
      'E-1,Meera,Iyer,meera@example.com,2023-06-01,Engineering,,B-1,FULL_TIME,ACTIVE',
      ',New,Joiner,,2025-01-10,,,E-1,INTERN,ACTIVE',
    ].join('\r\n');
    const dry = await ctx.http().post(`${API}/employees/import?dryRun=true`).set(h).attach('file', Buffer.from(good), 'people.csv');
    expect(dry.body.data).toMatchObject({ dryRun: true, total: 3, valid: 3, errorCount: 0, created: 0, ignoredColumns: ['Status'] });
    expect((await ctx.http().get(`${API}/employees?search=Meera`).set(h)).body.data).toHaveLength(0);

    const done = await ctx.http().post(`${API}/employees/import`).set(h).attach('file', Buffer.from(good), 'people.csv');
    expect(done.body.data).toMatchObject({ created: 3 });
    const meera = (await ctx.http().get(`${API}/employees?search=Meera`).set(h)).body.data[0];
    expect(meera).toMatchObject({ employeeCode: 'E-1', manager: { id: boss.id }, department: { name: 'Engineering' } });
    const ravi = (await ctx.http().get(`${API}/employees?search=Ravi`).set(h)).body.data[0];
    expect(ravi).toMatchObject({ manager: { id: meera.id }, designation: { name: 'Engineer' }, employmentType: 'FULL_TIME' });
    expect((await ctx.http().get(`${API}/employees?search=Joiner`).set(h)).body.data[0]).toMatchObject({ employeeCode: 'EMP-0001', employmentType: 'INTERN' });
    expect((await ctx.http().get(`${API}/employees/${ravi.id}/history`).set(h)).body.data[0]).toMatchObject({ type: 'JOINED', note: 'Imported from CSV' });

    // Re-importing the same codes is rejected; loops in the file are reported.
    expect((await ctx.http().post(`${API}/employees/import`).set(h).attach('file', Buffer.from(good), 'people.csv')).body.data.errorCount).toBeGreaterThan(0);
    const loop = ['employee_code,first_name,last_name,date_of_joining,manager_code', 'L-1,A,A,2024-01-01,L-2', 'L-2,B,B,2024-01-01,L-1'].join('\n');
    expect((await ctx.http().post(`${API}/employees/import`).set(h).attach('file', Buffer.from(loop), 'loop.csv')).body.data.errors[0].message).toContain('reporting loop');
  });

  it('imports 10,000 rows within the time budget', async () => {
    const { h } = await adminSession();
    const lines = ['employee_code,first_name,last_name,date_of_joining,manager_code'];
    for (let i = 1; i <= 10_000; i++) lines.push(`P-${i},First${i},Last${i},2024-01-01,${i > 1 ? `P-${Math.ceil(i / 10)}` : ''}`);
    const started = Date.now();
    const res = await ctx.http().post(`${API}/employees/import`).set(h).attach('file', Buffer.from(lines.join('\n')), 'big.csv');
    expect(res.body.data).toMatchObject({ created: 10_000, errorCount: 0 });
    expect(Date.now() - started).toBeLessThan(60_000);
    const chart = (await ctx.http().get(`${API}/employees/org-chart`).set(h)).body.data;
    expect(chart).toEqual([expect.objectContaining({ employeeCode: 'P-1', reportCount: 9 })]);
  }, 120_000);

  it('builds the org chart within scope', async () => {
    const { organization, h } = await adminSession();
    const ceo = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Chief', lastName: 'Exec', dateOfJoining: '2020-01-01' })).body.data;
    const lead = await person(organization.id, h, ['team_lead'], { managerId: ceo.id });
    const dev = await person(organization.id, h, ['employee'], { managerId: lead.employee.id });

    const top = (await ctx.http().get(`${API}/employees/org-chart`).set(h)).body.data;
    expect(top).toEqual([expect.objectContaining({ id: ceo.id, reportCount: 1 })]);
    const level2 = (await ctx.http().get(`${API}/employees/org-chart?managerId=${ceo.id}`).set(h)).body.data;
    expect(level2).toEqual([expect.objectContaining({ id: lead.employee.id, reportCount: 1 })]);

    // The team lead sees their own subtree, starting with themselves.
    expect((await ctx.http().get(`${API}/employees/org-chart`).set(lead.h)).body.data).toEqual([expect.objectContaining({ id: lead.employee.id, reportCount: 1 })]);
    expect((await ctx.http().get(`${API}/employees/org-chart?managerId=${ceo.id}`).set(lead.h)).status).toBe(404);

    const chain = (await ctx.http().get(`${API}/employees/${dev.employee.id}/reporting-chain`).set(h)).body.data;
    expect(chain.map((c: { id: string }) => c.id)).toEqual([lead.employee.id, ceo.id]);
    expect((await ctx.http().get(`${API}/employees/${dev.employee.id}/reporting-chain`).set(lead.h)).body.data.map((c: { id: string }) => c.id)).toEqual([lead.employee.id]);
  });
});
