import { createHash } from 'node:crypto';
import { Notification } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('Offer approval, e-signature and pre-joining (e2e)', () => {
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
    const res = await ctx
      .http()
      .post(`${API}/employees`)
      .set(h)
      .send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  async function offerStage() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const designation = (await ctx.http().post(`${API}/designations`).set(h).send({ name: 'Backend Engineer' })).body.data;
    const manager = await person(org.organization.id, h, ['department_manager'], { departmentId: eng.id });
    const hr = await person(org.organization.id, h, ['hr_manager']);
    const recruiter = await person(org.organization.id, h, ['recruiter']);
    const req = await ctx.http().post(`${API}/recruitment/requisitions`).set(manager.h).send({
      title: 'Backend Engineer',
      designationId: designation.id,
      reason: 'NEW_ROLE',
      justification: 'Scaling the payments platform team',
      openings: 1,
      budgetMin: 1_200_000,
      budgetMax: 1_800_000,
      submit: true,
    });
    await ctx.http().post(`${API}/recruitment/requisitions/${req.body.data.id}/approve`).set(hr.h).send({});
    const job = (
      await ctx.http().post(`${API}/recruitment/jobs`).set(recruiter.h).send({ requisitionId: req.body.data.id, description: 'Build and run payment services in TypeScript and PostgreSQL.' })
    ).body.data;
    await ctx.http().post(`${API}/recruitment/jobs/${job.id}/status`).set(recruiter.h).send({ status: 'OPEN' });
    const c = (
      await ctx.http().post(`${API}/recruitment/candidates`).set(recruiter.h).send({ firstName: 'Meera', lastName: 'Iyer', email: 'meera@example.com', phone: '+91 90000 11111', jobId: job.id })
    ).body.data;
    const appId = c.applications[0].id as string;
    await ctx.http().post(`${API}/recruitment/applications/${appId}/stage`).set(recruiter.h).send({ stage: 'OFFER' });
    return { h, hr, recruiter, appId };
  }

  it('approves offers above budget, freezes the letter, and lets the candidate sign and share joining details', async () => {
    const { hr, recruiter, appId } = await offerStage();
    const offer = (
      await ctx
        .http()
        .post(`${API}/recruitment/applications/${appId}/offers`)
        .set(recruiter.h)
        .send({ annualCtc: 2_000_000, joiningDate: future(30), expiresOn: future(10) })
    ).body.data;
    expect(offer.approval).toMatchObject({ status: 'NOT_REQUIRED', required: expect.stringContaining('budget') });
    const release = () => ctx.http().post(`${API}/recruitment/offers/${offer.id}/release`).set(recruiter.h);
    expect((await release()).status).toBe(409);

    // Approval: never by the recruiter who drafted it; a change after approval needs approving again.
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.id}/submit-approval`).set(recruiter.h)).body.data.approval.status).toBe('PENDING');
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.id}/approve`).set(recruiter.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.id}/approve`).set(hr.h).send({ note: 'Exceptional candidate' })).body.data.approval).toMatchObject({
      status: 'APPROVED',
      note: 'Exceptional candidate',
    });
    expect((await ctx.http().patch(`${API}/recruitment/offers/${offer.id}`).set(recruiter.h).send({ annualCtc: 1_900_000 })).body.data.approval.status).toBe('NOT_REQUIRED');
    expect((await release()).status).toBe(409);
    await ctx.http().post(`${API}/recruitment/offers/${offer.id}/submit-approval`).set(recruiter.h);
    await ctx.http().post(`${API}/recruitment/offers/${offer.id}/approve`).set(hr.h).send({});

    // The organization's template, with checked placeholders.
    expect(
      (await ctx.http().put(`${API}/recruitment/offer-letter-template`).set(recruiter.h).send({ subject: 'Offer', body: 'Dear {{candidate_nickname}}, welcome aboard to the team.' })).status,
    ).toBe(422);
    const template = await ctx.http().put(`${API}/recruitment/offer-letter-template`).set(recruiter.h).send({
      subject: 'Welcome aboard, {{candidate_first_name}}',
      body: 'Dear {{candidate_name}},\n\nWe offer you **{{designation}}** at {{annual_ctc}} a year.\n\n- Joining: {{joining_date}}\n- Reply by: {{offer_expiry}}\n\n<script>alert(1)</script>',
    });
    expect(template.body.data.isDefault).toBe(false);

    ctx.mail.outbox.length = 0;
    const released = await release();
    expect(released.status).toBe(201);
    expect(released.body.data).toMatchObject({ status: 'RELEASED', emailed: true, portalUrl: expect.stringContaining('/offer/') });
    const token = decodeURIComponent(released.body.data.portalUrl.split('/offer/')[1]);
    expect(ctx.mail.outbox.find((m) => m.to === 'meera@example.com')!.text).toContain(released.body.data.portalUrl);

    const portal = (path = '') => `${API}/offer-portal/${encodeURIComponent(token)}${path}`;
    expect((await ctx.http().get(`${API}/offer-portal/not-a-real-token-at-all-xyz`)).status).toBe(404);
    const view = (await ctx.http().get(portal())).body.data;
    expect(view).toMatchObject({ candidate: { name: 'Meera Iyer' }, offer: { status: 'RELEASED', designation: 'Backend Engineer' }, canRespond: true, prejoining: { open: false } });
    expect(view.letterHtml).toContain('Welcome aboard, Meera');
    expect(view.letterHtml).toContain('<strong>Backend Engineer</strong>');
    expect(view.letterHtml).toContain('₹19,00,000');
    expect(view.letterHtml).not.toContain('<script>');

    // Signing: the typed name must match; the letter's hash is recorded.
    expect((await ctx.http().post(portal('/accept')).send({ signedName: 'Someone Else', agree: true })).status).toBe(422);
    expect((await ctx.http().post(portal('/accept')).send({ signedName: 'Meera Iyer', agree: false })).status).toBe(422);
    const signed = await ctx.http().post(portal('/accept')).set('User-Agent', 'e2e-browser').send({ signedName: '  meera   IYER ', agree: true });
    expect(signed.status).toBe(201);
    expect(signed.body.data).toMatchObject({ offer: { status: 'ACCEPTED' }, signature: { name: 'meera   IYER' }, prejoining: { open: true } });
    expect((await ctx.http().post(portal('/decline')).send({})).status).toBe(409);
    const hrView = (await ctx.http().get(`${API}/recruitment/offers/${offer.id}`).set(recruiter.h)).body.data;
    expect(hrView.signature.letterHash).toBe(createHash('sha256').update(view.letterHtml).digest('hex'));
    expect(await Notification.count({ where: { userId: recruiter.user.id, type: 'recruitment.offer' }, ...RAW })).toBeGreaterThanOrEqual(1);

    // Pre-joining: details (PAN stays masked) and documents.
    const details = await ctx
      .http()
      .put(portal('/details'))
      .send({
        dateOfBirth: '1995-03-14',
        gender: 'FEMALE',
        phone: '+91 98888 77777',
        address: '12 MG Road, Bengaluru',
        emergencyContactName: 'Lakshmi Iyer',
        emergencyContactPhone: '+91 97777 66666',
        pan: 'abcde1234f',
      });
    expect(details.status).toBe(200);
    expect(details.body.data.prejoining.details).toMatchObject({ pan: '••••••234F', phone: '+91 98888 77777' });
    expect((await ctx.http().post(portal('/documents')).field('category', 'IDENTITY').field('title', 'Aadhaar').attach('file', Buffer.from('not a document'), 'a.txt')).status).toBe(422);
    const uploaded = await ctx.http().post(portal('/documents')).field('category', 'IDENTITY').field('title', 'Aadhaar card').attach('file', PDF, 'aadhaar.pdf');
    expect(uploaded.body.data.prejoining.documents).toEqual([expect.objectContaining({ title: 'Aadhaar card', category: 'IDENTITY' })]);
    const pre = (await ctx.http().get(`${API}/recruitment/offers/${offer.id}/prejoining`).set(recruiter.h)).body.data;
    expect(pre).toMatchObject({ details: { dateOfBirth: '1995-03-14', pan: '••••••234F' }, documents: [expect.objectContaining({ title: 'Aadhaar card' })] });

    // Hiring brings the details and documents to the employee; the portal closes.
    const hired = await ctx.http().post(`${API}/recruitment/offers/${offer.id}/hire`).set(hr.h).send({});
    expect(hired.status).toBe(201);
    const employeeId = hired.body.data.employeeId as string;
    expect((await ctx.http().get(`${API}/employees/${employeeId}`).set(hr.h)).body.data).toMatchObject({ dateOfBirth: '1995-03-14', gender: 'FEMALE', phone: '+91 98888 77777' });
    expect((await ctx.http().get(`${API}/employees/${employeeId}/sensitive`).set(hr.h)).body.data.pan).toBe('ABCDE1234F');
    const documents = (await ctx.http().get(`${API}/employees/${employeeId}/documents`).set(hr.h)).body.data as { title: string; status: string }[];
    expect(documents).toEqual([expect.objectContaining({ title: 'Aadhaar card', status: 'PENDING' })]);
    expect((await ctx.http().get(portal())).status).toBe(404);
  });

  it('records a decline from the portal, and withdrawn offers close the link', async () => {
    const { recruiter, appId } = await offerStage();
    const offer = (
      await ctx
        .http()
        .post(`${API}/recruitment/applications/${appId}/offers`)
        .set(recruiter.h)
        .send({ annualCtc: 1_500_000, joiningDate: future(30) })
    ).body.data;
    expect(offer.approval.required).toBeNull();
    const released = (await ctx.http().post(`${API}/recruitment/offers/${offer.id}/release`).set(recruiter.h)).body.data;
    const token = decodeURIComponent(released.portalUrl.split('/offer/')[1]);
    const declined = await ctx
      .http()
      .post(`${API}/offer-portal/${encodeURIComponent(token)}/decline`)
      .send({ reason: 'Accepted another offer' });
    expect(declined.body.data).toMatchObject({ offer: { status: 'DECLINED' }, canRespond: false });
    expect((await ctx.http().get(`${API}/recruitment/offers/${offer.id}`).set(recruiter.h)).body.data).toMatchObject({ status: 'DECLINED', declineReason: 'Accepted another offer' });

    // A reissued link replaces the old one.
    const second = (
      await ctx
        .http()
        .post(`${API}/recruitment/applications/${appId}/offers`)
        .set(recruiter.h)
        .send({ annualCtc: 1_600_000, joiningDate: future(30) })
    ).body.data;
    const first = (await ctx.http().post(`${API}/recruitment/offers/${second.id}/release`).set(recruiter.h)).body.data.portalUrl as string;
    const again = (await ctx.http().post(`${API}/recruitment/offers/${second.id}/resend-link`).set(recruiter.h)).body.data.portalUrl as string;
    expect(again).not.toBe(first);
    expect((await ctx.http().get(`${API}/offer-portal/${first.split('/offer/')[1]}`)).status).toBe(404);
    await ctx.http().post(`${API}/recruitment/offers/${second.id}/withdraw`).set(recruiter.h);
    expect((await ctx.http().get(`${API}/offer-portal/${again.split('/offer/')[1]}`)).status).toBe(404);
  });
});
