import { AuditLog, Notification } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgDays, orgToday, resetDatabase, totp, uniqueEmail } from './helpers';

describe('Billing, manual (e2e)', () => {
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

  async function superAdmin() {
    const user = await createUser(ctx, { email: uniqueEmail('root'), platformRole: 'SUPER_ADMIN' });
    const s = await login(ctx, user.email);
    const setup = await ctx.http().post(`${API}/auth/mfa/setup`).set(bearer(s.accessToken));
    await ctx.http().post(`${API}/auth/mfa/enable`).set(bearer(s.accessToken)).send({ code: totp(setup.body.data.secret) });
    return bearer(s.accessToken);
  }

  it('bills an organization by period, records payments and enforces seats', async () => {
    const root = await superAdmin();
    const { organization, roleIdsByKey, admin } = await createOrgWithAdmin(ctx, { planCode: 'starter', name: 'Acme Robotics' });
    const h = bearer((await login(ctx, admin.email)).accessToken);
    const staff = await createUser(ctx, { email: uniqueEmail('staff') });
    await addMember(ctx, organization.id, staff.id, ['employee']);
    const staffH = bearer((await login(ctx, staff.email)).accessToken);
    const P = `${API}/platform/billing`;

    // The organization sees its plan terms before any subscription is set.
    const start = (await ctx.http().get(`${API}/organizations/current/billing`).set(h)).body.data;
    expect(start.subscription).toMatchObject({ status: 'TRIAL', plan: { code: 'starter' }, seats: { used: 2, limit: 50 }, pricePerMonth: 4999, billingCycle: 'MONTHLY' });
    expect(start.invoices).toEqual([]);
    expect((await ctx.http().get(`${API}/organizations/current/billing`).set(staffH)).status).toBe(403);
    expect((await ctx.http().get(P).set(h)).status).toBe(403);

    // Terms: quarterly, 10% off, 3 seats, a billing contact.
    expect((await ctx.http().put(`${P}/organizations/${organization.id}/subscription`).set(root).send({ billingTaxId: 'bad id!' })).status).toBe(422);
    const terms = await ctx.http().put(`${P}/organizations/${organization.id}/subscription`).set(root).send({ billingCycle: 'QUARTERLY', discountPct: 10, seats: 3, billingEmail: ' Accounts@Acme.test ', nextPeriodStart: '2026-10-01' });
    expect(terms.status).toBe(200);
    expect(terms.body.data.subscription).toMatchObject({ billingCycle: 'QUARTERLY', seats: { used: 2, limit: 3, override: 3 }, monthlyAmount: 4499.1, cycleAmount: 13497.3, contact: { billingEmail: 'accounts@acme.test' } });

    // The seat limit applies to invitations.
    const invite = () => ctx.http().post(`${API}/users/invitations`).set(h).send({ email: uniqueEmail('new'), firstName: 'New', lastName: 'Person', roleIds: [roleIdsByKey.get('employee')] });
    expect((await invite()).status).toBe(201);
    const full = await invite();
    expect(full.status).toBe(403);
    expect(full.body.error.message).toMatch(/up to 3 users/);

    // A draft for the next quarter, with an extra line.
    const created = await ctx.http().post(`${P}/organizations/${organization.id}/invoices`).set(root).send({ extraLines: [{ description: 'Onboarding & data migration', quantity: 1, unitPrice: 5000 }] });
    expect(created.status).toBe(201);
    const draft = created.body.data;
    expect(draft).toMatchObject({ status: 'DRAFT', number: null, periodStart: '2026-10-01', periodEnd: '2026-12-31', subtotal: 19997, discount: 1999.7, tax: 3239.51, total: 21236.81 });
    expect(draft.lines[0]).toMatchObject({ description: 'Starter plan · Oct 2026 – Dec 2026', quantity: 3, unitPrice: 4999, amount: 14997 });
    expect((await ctx.http().post(`${P}/organizations/${organization.id}/invoices`).set(root).send({})).status).toBe(409);
    // Drafts stay with the platform.
    expect((await ctx.http().get(`${API}/organizations/current/billing`).set(h)).body.data.invoices).toEqual([]);
    expect((await ctx.http().get(`${API}/organizations/current/billing/invoices/${draft.id}/pdf`).set(h)).status).toBe(404);

    const edited = (await ctx.http().patch(`${P}/invoices/${draft.id}`).set(root).send({ lines: [{ description: draft.lines[0].description, quantity: 3, unitPrice: 4999 }] })).body.data;
    expect(edited).toMatchObject({ subtotal: 14997, discount: 1499.7, tax: 2429.51, total: 15926.81 });
    expect((await ctx.http().post(`${P}/invoices/${draft.id}/payments`).set(root).send({ amount: 100, paidOn: orgToday(), method: 'UPI' })).status).toBe(409);

    // Issuing numbers it, sets the due date, moves to the next period, notifies and emails.
    const issued = (await ctx.http().post(`${P}/invoices/${draft.id}/issue`).set(root)).body.data;
    expect(issued).toMatchObject({ status: 'ISSUED', number: `INV-${orgToday().slice(0, 4)}-0001`, issueDate: orgToday(), dueDate: orgDays(15), billTo: { name: 'Acme Robotics', email: 'accounts@acme.test' } });
    expect((await ctx.http().patch(`${P}/invoices/${draft.id}`).set(root).send({ notes: 'x' })).status).toBe(409);
    expect(await Notification.count({ where: { userId: admin.id, type: 'billing.invoice_issued' }, ...RAW })).toBe(1);
    const mail = ctx.mail.outbox.find((m) => m.to === 'accounts@acme.test');
    expect(mail?.subject).toContain(issued.number);
    expect(mail?.attachments?.[0]).toMatchObject({ filename: `${issued.number}.pdf`, type: 'application/pdf' });

    // Payments, in part and then the rest.
    const pay = (body: Record<string, unknown>) => ctx.http().post(`${P}/invoices/${draft.id}/payments`).set(root).send({ paidOn: orgToday(), method: 'BANK_TRANSFER', ...body });
    expect((await pay({ amount: 20000 })).body.error.details[0].message).toMatch(/balance due is ₹15,926.81/);
    expect((await pay({ amount: 100, paidOn: orgDays(1) })).status).toBe(422);
    expect((await pay({ amount: 10000, reference: 'UTR123' })).body.data).toMatchObject({ status: 'ISSUED', amountPaid: 10000, balance: 5926.81 });
    expect((await pay({ amount: 5926.81 })).body.data).toMatchObject({ status: 'PAID', balance: 0 });
    expect((await ctx.http().post(`${P}/invoices/${draft.id}/void`).set(root).send({ reason: 'Wrong' })).status).toBe(409);

    // The next quarter, voided before payment: the period opens again.
    const next = (await ctx.http().post(`${P}/organizations/${organization.id}/invoices`).set(root).send({})).body.data;
    expect(next.periodStart).toBe('2027-01-01');
    expect((await ctx.http().post(`${P}/invoices/${next.id}/issue`).set(root)).body.data.number).toBe(`INV-${orgToday().slice(0, 4)}-0002`);
    expect((await ctx.http().post(`${P}/invoices/${next.id}/void`).set(root).send({ reason: 'Price change agreed' })).body.data).toMatchObject({ status: 'VOID', balance: 0 });
    const detail = (await ctx.http().get(`${P}/organizations/${organization.id}`).set(root)).body.data;
    expect(detail.subscription).toMatchObject({ status: 'ACTIVE', nextPeriodStart: '2027-01-01' });

    // Platform overview and invoice list.
    const overview = (await ctx.http().get(P).set(root)).body.data;
    expect(overview.totals.find((t: { currency: string }) => t.currency === 'INR')).toMatchObject({ mrr: 4499.1, outstanding: 0, collectedThisMonth: 15926.81 });
    expect(overview.organizations.find((o: { organization: { id: string } }) => o.organization.id === organization.id)).toMatchObject({ status: 'ACTIVE', balanceDue: 0, pastDue: false });
    const paid = (await ctx.http().get(`${P}/invoices?status=PAID&search=acme`).set(root)).body;
    expect(paid.data.map((i: { number: string }) => i.number)).toEqual([issued.number]);

    // The organization's view: issued invoices with payments, a PDF, and its billing contact.
    const mine = (await ctx.http().get(`${API}/organizations/current/billing`).set(h)).body.data;
    expect(mine.invoices.map((i: { status: string }) => i.status)).toEqual(['VOID', 'PAID']);
    expect(mine.invoices[1].payments).toHaveLength(2);
    const file = await ctx.http().get(`${API}/organizations/current/billing/invoices/${draft.id}/pdf`).set(h).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect((await ctx.http().put(`${API}/organizations/current/billing/contact`).set(h).send({ billingTaxId: '29abcde1234f1z5', billingName: 'Acme Robotics Pvt Ltd' })).body.data.subscription.contact).toMatchObject({ billingTaxId: '29ABCDE1234F1Z5', billingName: 'Acme Robotics Pvt Ltd' });
    expect((await ctx.http().put(`${API}/organizations/current/billing/contact`).set(staffH).send({ billingName: 'x' })).status).toBe(403);

    const actions = (await AuditLog.findAll({ where: { organizationId: organization.id }, attributes: ['action'], ...RAW })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['billing.subscription_updated', 'billing.invoice_created', 'billing.invoice_issued', 'billing.payment_recorded', 'billing.invoice_voided', 'billing.contact_updated']));
  });

  it('needs a price for custom-priced plans and lets drafts be deleted', async () => {
    const root = await superAdmin();
    const { organization } = await createOrgWithAdmin(ctx, { planCode: 'enterprise' });
    const P = `${API}/platform/billing`;
    const blocked = await ctx.http().post(`${P}/organizations/${organization.id}/invoices`).set(root).send({});
    expect(blocked.body.error.details[0].message).toMatch(/custom pricing/);
    await ctx.http().put(`${P}/organizations/${organization.id}/subscription`).set(root).send({ pricePerMonth: 75000, taxRatePct: 0 });
    const draft = (await ctx.http().post(`${P}/organizations/${organization.id}/invoices`).set(root).send({ periodStart: '2026-11-01' })).body.data;
    expect(draft).toMatchObject({ total: 75000, periodEnd: '2026-11-30' });
    expect((await ctx.http().delete(`${P}/invoices/${draft.id}`).set(root)).status).toBe(204);
    expect((await ctx.http().post(`${P}/organizations/${organization.id}/invoices`).set(root).send({ periodStart: '2026-11-01' })).status).toBe(201);
    await ctx.http().put(`${P}/organizations/${organization.id}/subscription`).set(root).send({ status: 'CANCELLED' });
    expect((await ctx.http().post(`${P}/organizations/${organization.id}/invoices`).set(root).send({ periodStart: '2026-12-01' })).status).toBe(409);
  });
});
