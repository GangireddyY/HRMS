import { Injectable } from '@nestjs/common';
import { Op, QueryTypes, type Transaction } from 'sequelize';
import { CYCLE_MONTHS, type BillingCycle, type BillTo, type InvoiceLine } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { PaginationQueryDto, paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { addDays, addMonths, zonedParts } from '../../common/utils/zoned-time';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import { Invoice, InvoicePayment, MembershipRole, Organization, OrganizationMembership, OrganizationSubscription, Permission, Plan, RolePermission } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { invoiceEmail } from '../../infrastructure/mail/templates';
import { NotificationsService } from '../notifications/notifications.service';
import type { BillingContactDto, CreateInvoiceDto, InvoiceLineDto, InvoiceQueryDto, RecordPaymentDto, UpdateInvoiceDto, UpdateSubscriptionDto } from './dto/billing.dto';
import { invoicePdf } from './invoice-pdf';

const PLATFORM = { skipTenantScope: true } as const;
const INVOICE_EMAIL_JOB = 'billing.invoice_email';
const BILLER = { name: 'HRMS', address: null, taxId: null };
const SEAT_STATUSES = ['ACTIVE', 'INVITED'];

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${monthLabel(iso)}`;
const amountLabel = (n: number, currency: string) => `${currency === 'INR' ? '₹' : `${currency} `}${n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function priced(lines: InvoiceLineDto[] | InvoiceLine[]): InvoiceLine[] {
  return lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: r2(l.quantity * l.unitPrice) }));
}

/** Subtotal less the discount, plus tax. A credit can't take the total below zero. */
export function invoiceTotals(lines: InvoiceLine[], discountPct: number, taxRatePct: number) {
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const discount = r2(Math.max(0, subtotal) * (discountPct / 100));
  const taxable = r2(subtotal - discount);
  if (taxable < 0) throw AppError.validation([{ field: 'lines', message: "Credits can't take the invoice below zero" }]);
  const tax = r2(taxable * (taxRatePct / 100));
  return { subtotal, discount, tax, total: r2(taxable + tax) };
}

/**
 * Manual billing. The platform sets each organization's subscription terms (plan, cycle, seat and price overrides,
 * discount, tax, payment terms), generates an invoice per period, issues it (numbered INV-2026-0001, emailed to the
 * billing contact) and records the payments it receives. Organizations see their subscription, seats and invoices.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobQueueService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {
    this.jobs.register<{ invoiceId: string }>(INVOICE_EMAIL_JOB, (p) => this.emailInvoice(p.invoiceId));
  }

  // ── Platform ─────────────────────────────────────────────────────────────

  async overview() {
    const [orgs, subs, seatRows, open, collected] = await Promise.all([
      Organization.findAll({ attributes: ['id', 'name', 'slug', 'status', 'currency', 'planId'], include: [{ model: Plan, attributes: ['id', 'name', 'code', 'maxUsers', 'monthlyPrice', 'currency'] }], order: [['name', 'ASC']] }),
      OrganizationSubscription.findAll(PLATFORM),
      OrganizationMembership.findAll({ attributes: ['organizationId', [this.db.sequelize.fn('COUNT', this.db.sequelize.col('id')), 'n']], where: { status: { [Op.in]: SEAT_STATUSES } }, group: ['organizationId'], raw: true, ...PLATFORM }) as unknown as Promise<{ organizationId: string; n: string }[]>,
      Invoice.findAll({ where: { status: 'ISSUED' }, attributes: ['organizationId', 'currency', 'total', 'amountPaid', 'dueDate'], ...PLATFORM }),
      InvoicePayment.findAll({ where: { paidOn: { [Op.gte]: `${this.today().slice(0, 7)}-01` } }, attributes: ['amount', 'invoiceId'], include: [{ model: Invoice, attributes: ['currency'] }], ...PLATFORM }),
    ]);
    const subBy = new Map(subs.map((s) => [s.organizationId, s]));
    const seatsBy = new Map(seatRows.map((r) => [r.organizationId, Number(r.n)]));
    const today = this.today();
    const rows = orgs.map((o) => {
      const own = open.filter((i) => i.organizationId === o.id);
      const balance = r2(own.reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0));
      const overdue = r2(own.filter((i) => i.dueDate! < today).reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0));
      return { organization: { id: o.id, name: o.name, slug: o.slug, status: o.status }, ...this.terms(o, subBy.get(o.id) ?? null, seatsBy.get(o.id) ?? 0), balanceDue: balance, overdue, pastDue: overdue > 0 };
    });
    const currencies = [...new Set(rows.map((r) => r.currency))];
    const totals = currencies.map((currency) => {
      const mine = rows.filter((r) => r.currency === currency);
      return {
        currency,
        mrr: r2(mine.filter((r) => r.status === 'ACTIVE').reduce((s, r) => s + (r.monthlyAmount ?? 0), 0)),
        outstanding: r2(mine.reduce((s, r) => s + r.balanceDue, 0)),
        overdue: r2(mine.reduce((s, r) => s + r.overdue, 0)),
        collectedThisMonth: r2(collected.filter((p) => (p.invoice?.currency ?? currency) === currency).reduce((s, p) => s + Number(p.amount), 0)),
        organizations: mine.length,
      };
    });
    return { totals, organizations: rows };
  }

  async organization(organizationId: string) {
    const org = await this.org(organizationId);
    const [sub, seats, invoices] = await Promise.all([
      OrganizationSubscription.findOne({ where: { organizationId }, ...PLATFORM }),
      OrganizationMembership.count({ where: { organizationId, status: { [Op.in]: SEAT_STATUSES } }, ...PLATFORM }),
      Invoice.findAll({ where: { organizationId }, include: [{ model: InvoicePayment }], order: [['createdAt', 'DESC']], ...PLATFORM }),
    ]);
    return {
      organization: { id: org.id, name: org.name, slug: org.slug, status: org.status },
      subscription: { ...this.terms(org, sub, seats), ...this.contact(org, sub), notes: sub?.notes ?? null, cancelledAt: sub?.cancelledAt ?? null },
      ...this.balances(invoices),
      invoices: invoices.map((i) => this.presentInvoice(i)),
    };
  }

  async updateSubscription(auth: AuthContext, organizationId: string, dto: UpdateSubscriptionDto) {
    await this.org(organizationId);
    await this.db.transaction(async (transaction) => {
      const sub = await this.subscription(organizationId, auth, transaction);
      const before = sub.get({ plain: true });
      const patch: Partial<OrganizationSubscription> = { ...dto, updatedById: auth.userId } as Partial<OrganizationSubscription>;
      if (dto.status === 'CANCELLED' && sub.status !== 'CANCELLED') patch.cancelledAt = new Date();
      if (dto.status && dto.status !== 'CANCELLED') patch.cancelledAt = null;
      await sub.update(patch, { transaction, ...PLATFORM });
      const changes = Object.fromEntries(
        Object.keys(dto)
          .filter((k) => String(before[k as keyof typeof before] ?? '') !== String(sub.get(k as never) ?? ''))
          .map((k) => [k, { from: before[k as keyof typeof before] ?? null, to: sub.get(k as never) ?? null }]),
      );
      await this.audit.record({ action: 'billing.subscription_updated', entityType: 'OrganizationSubscription', entityId: sub.id, organizationId, summary: 'Subscription terms updated', changes }, transaction);
    });
    return this.organization(organizationId);
  }

  async invoices(q: InvoiceQueryDto) {
    const today = this.today();
    const where: Record<string | symbol, unknown> = {};
    if (q.organizationId) where.organizationId = q.organizationId;
    if (q.status === 'OVERDUE') Object.assign(where, { status: 'ISSUED', dueDate: { [Op.lt]: today } });
    else if (q.status) where.status = q.status;
    if (q.search) where[Op.or] = [{ number: { [Op.iLike]: `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` } }, { '$organization.name$': { [Op.iLike]: `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` } }];
    const { rows, count } = await Invoice.findAndCountAll({
      where,
      include: [{ model: Organization, attributes: ['id', 'name', 'slug'] }],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'ASC'],
      ],
      ...paginationArgs(q as PaginationQueryDto),
      ...PLATFORM,
    });
    return new PaginatedResult(
      rows.map((i) => ({ ...this.presentInvoice(i), organization: i.organization ? { id: i.organization.id, name: i.organization.name, slug: i.organization.slug } : null })),
      paginationMeta(q, count),
    );
  }

  /** A draft for the subscription's next period (or the one given): the plan for the cycle, the discount and tax. */
  async createInvoice(auth: AuthContext, organizationId: string, dto: CreateInvoiceDto) {
    const org = await this.org(organizationId);
    const id = await this.db.transaction(async (transaction) => {
      const sub = await this.subscription(organizationId, auth, transaction);
      if (sub.status === 'CANCELLED') throw AppError.conflict('The subscription is cancelled; reactivate it to invoice');
      const terms = this.terms(org, sub, 0);
      if (terms.pricePerMonth === null) throw AppError.validation([{ field: 'pricePerMonth', message: 'The plan has custom pricing: set a monthly price for this organization first' }]);
      const start = dto.periodStart ?? sub.nextPeriodStart ?? `${this.today(org.timezone).slice(0, 7)}-01`;
      const months = CYCLE_MONTHS[terms.billingCycle];
      const end = addDays(addMonths(start, months), -1);
      if (await Invoice.count({ where: { organizationId, periodStart: start, status: { [Op.ne]: 'VOID' } }, transaction, ...PLATFORM })) {
        throw AppError.conflict(`There's already an invoice for the period from ${dayLabel(start)}`);
      }
      const period = months === 1 ? monthLabel(start) : `${monthLabel(start)} – ${monthLabel(end)}`;
      const lines = priced([{ description: `${org.plan?.name ?? 'HRMS'} plan · ${period}`, quantity: months, unitPrice: terms.pricePerMonth }, ...(dto.extraLines ?? [])]);
      const totals = invoiceTotals(lines, terms.discountPct, terms.taxRatePct);
      const invoice = await Invoice.create(
        { organizationId, periodStart: start, periodEnd: end, currency: terms.currency, lines, ...totals, taxRatePct: terms.taxRatePct, notes: dto.notes || null, createdById: auth.userId, updatedById: auth.userId },
        { transaction, ...PLATFORM },
      );
      await this.audit.record({ action: 'billing.invoice_created', entityType: 'Invoice', entityId: invoice.id, organizationId, summary: `Draft invoice for ${period}: ${amountLabel(totals.total, terms.currency)}` }, transaction);
      return invoice.id;
    });
    return this.invoice(id);
  }

  async updateInvoice(auth: AuthContext, id: string, dto: UpdateInvoiceDto) {
    await this.db.transaction(async (transaction) => {
      const invoice = await this.locked(id, transaction);
      if (invoice.status !== 'DRAFT') throw AppError.conflict('Only a draft invoice can be changed; void it and create another');
      const sub = await OrganizationSubscription.findOne({ where: { organizationId: invoice.organizationId }, transaction, ...PLATFORM });
      const lines = dto.lines ? priced(dto.lines) : invoice.lines;
      if (!lines.length) throw AppError.validation([{ field: 'lines', message: 'Add at least one line' }]);
      const taxRatePct = dto.taxRatePct ?? Number(invoice.taxRatePct);
      const totals = invoiceTotals(lines, Number(sub?.discountPct ?? 0), taxRatePct);
      await invoice.update({ lines, taxRatePct, ...totals, ...(dto.notes !== undefined ? { notes: dto.notes } : {}), updatedById: auth.userId }, { transaction, ...PLATFORM });
      await this.audit.record({ action: 'billing.invoice_updated', entityType: 'Invoice', entityId: id, organizationId: invoice.organizationId, summary: `Draft invoice changed: ${amountLabel(totals.total, invoice.currency)}` }, transaction);
    });
    return this.invoice(id);
  }

  async deleteDraft(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const invoice = await this.locked(id, transaction);
      if (invoice.status !== 'DRAFT') throw AppError.conflict('Only a draft can be deleted; void an issued invoice instead');
      await invoice.destroy({ transaction, ...PLATFORM });
      await this.audit.record({ action: 'billing.invoice_deleted', entityType: 'Invoice', entityId: id, organizationId: invoice.organizationId, summary: 'Draft invoice deleted' }, transaction);
    });
  }

  /** Numbers the invoice, snapshots who it's billed to, sets the due date and moves the subscription to the next period. */
  async issue(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const invoice = await this.locked(id, transaction);
      if (invoice.status !== 'DRAFT') throw AppError.conflict('This invoice has already been issued');
      if (Number(invoice.total) <= 0) throw AppError.validation([{ field: 'lines', message: 'There is nothing to bill on this invoice' }]);
      const org = await this.org(invoice.organizationId, transaction);
      const sub = await this.subscription(invoice.organizationId, auth, transaction);
      const today = this.today(org.timezone);
      await this.db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key: 'billing:invoice-number' }, type: QueryTypes.SELECT, transaction });
      const prefix = `INV-${today.slice(0, 4)}-`;
      const last = await Invoice.findOne({ where: { number: { [Op.like]: `${prefix}%` } }, attributes: ['number'], order: [['number', 'DESC']], transaction, ...PLATFORM });
      const number = `${prefix}${String(Number(last?.number?.slice(prefix.length) ?? 0) + 1).padStart(4, '0')}`;
      await invoice.update(
        { number, status: 'ISSUED', issueDate: today, dueDate: addDays(today, sub.paymentTermsDays), billTo: this.contact(org, sub).billTo, issuedAt: new Date(), updatedById: auth.userId },
        { transaction, ...PLATFORM },
      );
      if (invoice.periodEnd && (!sub.nextPeriodStart || sub.nextPeriodStart <= invoice.periodEnd)) await sub.update({ nextPeriodStart: addDays(invoice.periodEnd, 1) }, { transaction, ...PLATFORM });
      await this.audit.record({ action: 'billing.invoice_issued', entityType: 'Invoice', entityId: id, organizationId: invoice.organizationId, summary: `${number} issued: ${amountLabel(Number(invoice.total), invoice.currency)} due ${dayLabel(invoice.dueDate!)}` }, transaction);
      await this.tell(invoice.organizationId, { type: 'billing.invoice_issued', title: `Invoice ${number}: ${amountLabel(Number(invoice.total), invoice.currency)} due ${dayLabel(invoice.dueDate!)}`, body: 'Your HRMS subscription invoice is ready.' }, transaction);
      if (sub.billingEmail) await this.jobs.enqueue(INVOICE_EMAIL_JOB, { invoiceId: id }, { transaction, organizationId: invoice.organizationId, maxAttempts: 4 });
    });
    return this.invoice(id);
  }

  async recordPayment(auth: AuthContext, id: string, dto: RecordPaymentDto) {
    await this.db.transaction(async (transaction) => {
      const invoice = await this.locked(id, transaction);
      if (invoice.status !== 'ISSUED') throw AppError.conflict(invoice.status === 'PAID' ? 'This invoice is already paid' : 'Issue the invoice before recording a payment');
      const balance = r2(Number(invoice.total) - Number(invoice.amountPaid));
      if (dto.amount > balance) throw AppError.validation([{ field: 'amount', message: `The balance due is ${amountLabel(balance, invoice.currency)}` }]);
      if (invoice.issueDate && dto.paidOn < invoice.issueDate) throw AppError.validation([{ field: 'paidOn', message: "The payment can't be before the invoice was issued" }]);
      const org = await this.org(invoice.organizationId, transaction);
      if (dto.paidOn > this.today(org.timezone)) throw AppError.validation([{ field: 'paidOn', message: "The payment date can't be in the future" }]);
      await InvoicePayment.create({ organizationId: invoice.organizationId, invoiceId: id, amount: dto.amount, paidOn: dto.paidOn, method: dto.method, reference: dto.reference || null, note: dto.note || null, recordedById: auth.userId }, { transaction, ...PLATFORM });
      const paid = r2(Number(invoice.amountPaid) + dto.amount);
      const settled = paid >= Number(invoice.total);
      await invoice.update({ amountPaid: paid, ...(settled ? { status: 'PAID' as const, paidAt: new Date() } : {}), updatedById: auth.userId }, { transaction, ...PLATFORM });
      const sub = await this.subscription(invoice.organizationId, auth, transaction);
      if (sub.status === 'TRIAL') await sub.update({ status: 'ACTIVE', updatedById: auth.userId }, { transaction, ...PLATFORM });
      await this.audit.record(
        { action: 'billing.payment_recorded', entityType: 'Invoice', entityId: id, organizationId: invoice.organizationId, summary: `${amountLabel(dto.amount, invoice.currency)} received for ${invoice.number}${settled ? ' (paid in full)' : ''}`, metadata: { method: dto.method, paidOn: dto.paidOn } },
        transaction,
      );
      await this.tell(invoice.organizationId, { type: 'billing.payment_received', title: `Payment of ${amountLabel(dto.amount, invoice.currency)} received for ${invoice.number}`, body: settled ? 'The invoice is paid in full. Thank you!' : `Balance due: ${amountLabel(r2(Number(invoice.total) - paid), invoice.currency)}` }, transaction);
    });
    return this.invoice(id);
  }

  async void(auth: AuthContext, id: string, reason: string) {
    await this.db.transaction(async (transaction) => {
      const invoice = await this.locked(id, transaction);
      if (invoice.status === 'VOID') throw AppError.conflict('This invoice is already void');
      if (Number(invoice.amountPaid) > 0) throw AppError.conflict('A payment has been recorded on this invoice; it can’t be voided');
      await invoice.update({ status: 'VOID', voidedAt: new Date(), voidReason: reason, updatedById: auth.userId }, { transaction, ...PLATFORM });
      const sub = await OrganizationSubscription.findOne({ where: { organizationId: invoice.organizationId }, transaction, ...PLATFORM });
      if (sub && invoice.periodEnd && sub.nextPeriodStart === addDays(invoice.periodEnd, 1)) await sub.update({ nextPeriodStart: invoice.periodStart }, { transaction, ...PLATFORM });
      await this.audit.record({ action: 'billing.invoice_voided', entityType: 'Invoice', entityId: id, organizationId: invoice.organizationId, summary: `${invoice.number ?? 'Draft'} voided: ${reason}` }, transaction);
    });
    return this.invoice(id);
  }

  async pdf(id: string, organizationId?: string) {
    const invoice = await Invoice.findOne({ where: { id, ...(organizationId ? { organizationId } : {}) }, ...PLATFORM });
    if (!invoice || (organizationId && invoice.status === 'DRAFT')) throw AppError.notFound('Invoice');
    const billTo = invoice.billTo ?? this.contact(await this.org(invoice.organizationId), await OrganizationSubscription.findOne({ where: { organizationId: invoice.organizationId }, ...PLATFORM })).billTo;
    const buffer = await invoicePdf(
      { ...this.presentInvoice(invoice), billTo, lines: invoice.lines, notes: invoice.notes },
      BILLER,
    );
    return { buffer, fileName: `${invoice.number ?? `draft-${invoice.id.slice(0, 8)}`}.pdf` };
  }

  // ── The organization's own view ──────────────────────────────────────────

  async mine(auth: AuthContext) {
    const organizationId = auth.organizationId!;
    const org = await this.org(organizationId);
    const [sub, seats, invoices] = await Promise.all([
      OrganizationSubscription.findOne({ where: { organizationId } }),
      OrganizationMembership.count({ where: { status: { [Op.in]: SEAT_STATUSES } } }),
      Invoice.findAll({ where: { status: { [Op.ne]: 'DRAFT' } }, include: [{ model: InvoicePayment }], order: [['issueDate', 'DESC'], ['createdAt', 'DESC']] }),
    ]);
    return { subscription: { ...this.terms(org, sub, seats), ...this.contact(org, sub) }, ...this.balances(invoices), invoices: invoices.map((i) => this.presentInvoice(i)) };
  }

  async updateContact(auth: AuthContext, dto: BillingContactDto) {
    const organizationId = auth.organizationId!;
    await this.db.transaction(async (transaction) => {
      const sub = await this.subscription(organizationId, auth, transaction);
      await sub.update({ ...dto, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'billing.contact_updated', entityType: 'OrganizationSubscription', entityId: sub.id, summary: 'Billing contact updated' }, transaction);
    });
    return this.mine(auth);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private today(timeZone = 'Asia/Kolkata') {
    return zonedParts(new Date(), timeZone).date;
  }

  private async org(id: string, transaction?: Transaction) {
    const org = await Organization.findByPk(id, { include: [{ model: Plan, attributes: ['id', 'name', 'code', 'maxUsers', 'monthlyPrice', 'currency'] }], transaction });
    if (!org) throw AppError.notFound('Organization');
    return org;
  }

  private async subscription(organizationId: string, auth: AuthContext, transaction: Transaction) {
    const existing = await OrganizationSubscription.findOne({ where: { organizationId }, transaction, lock: transaction.LOCK.UPDATE, ...PLATFORM });
    return existing ?? OrganizationSubscription.create({ organizationId, createdById: auth.userId, updatedById: auth.userId }, { transaction, ...PLATFORM });
  }

  private async locked(id: string, transaction: Transaction) {
    const invoice = await Invoice.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE, ...PLATFORM });
    if (!invoice) throw AppError.notFound('Invoice');
    return invoice;
  }

  private async invoice(id: string) {
    const invoice = await Invoice.findByPk(id, { include: [{ model: InvoicePayment }], ...PLATFORM });
    if (!invoice) throw AppError.notFound('Invoice');
    return this.presentInvoice(invoice);
  }

  private terms(org: Organization, sub: OrganizationSubscription | null, seatsUsed: number) {
    const plan = org.plan;
    const pricePerMonth = num(sub?.pricePerMonth) ?? num(plan?.monthlyPrice);
    const discountPct = Number(sub?.discountPct ?? 0);
    const billingCycle: BillingCycle = sub?.billingCycle ?? 'MONTHLY';
    const monthlyAmount = pricePerMonth === null ? null : r2(pricePerMonth * (1 - discountPct / 100));
    return {
      plan: plan ? { id: plan.id, name: plan.name, code: plan.code, maxUsers: plan.maxUsers, monthlyPrice: num(plan.monthlyPrice) } : null,
      status: sub?.status ?? 'TRIAL',
      billingCycle,
      currency: plan?.currency ?? org.currency ?? 'INR',
      seats: { used: seatsUsed, limit: sub?.seats ?? plan?.maxUsers ?? null, override: sub?.seats ?? null },
      pricePerMonth,
      priceOverride: num(sub?.pricePerMonth),
      discountPct,
      taxRatePct: Number(sub?.taxRatePct ?? 18),
      paymentTermsDays: sub?.paymentTermsDays ?? 15,
      trialEndsOn: sub?.trialEndsOn ?? null,
      nextPeriodStart: sub?.nextPeriodStart ?? null,
      /** Before tax. */
      monthlyAmount,
      cycleAmount: monthlyAmount === null ? null : r2(monthlyAmount * CYCLE_MONTHS[billingCycle]),
    };
  }

  private contact(org: Organization, sub: OrganizationSubscription | null) {
    const address = [org.addressLine1, org.addressLine2, org.city, org.state, org.postalCode].filter(Boolean).join(', ') || null;
    const billTo: BillTo = { name: sub?.billingName ?? org.legalName ?? org.name, email: sub?.billingEmail ?? org.email ?? null, address: sub?.billingAddress ?? address, taxId: sub?.billingTaxId ?? org.taxId ?? null };
    return { contact: { billingName: sub?.billingName ?? null, billingEmail: sub?.billingEmail ?? null, billingAddress: sub?.billingAddress ?? null, billingTaxId: sub?.billingTaxId ?? null }, billTo };
  }

  private balances(invoices: Invoice[]) {
    const today = this.today();
    const open = invoices.filter((i) => i.status === 'ISSUED');
    const due = (list: Invoice[]) => r2(list.reduce((s, i) => s + Number(i.total) - Number(i.amountPaid), 0));
    return { balanceDue: due(open), overdue: due(open.filter((i) => i.dueDate! < today)) };
  }

  private presentInvoice(i: Invoice) {
    const today = this.today();
    const total = Number(i.total);
    const paid = Number(i.amountPaid);
    return {
      id: i.id,
      organizationId: i.organizationId,
      number: i.number,
      status: i.status,
      overdue: i.status === 'ISSUED' && !!i.dueDate && i.dueDate < today,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      currency: i.currency,
      lines: i.lines,
      subtotal: Number(i.subtotal),
      discount: Number(i.discount),
      taxRatePct: Number(i.taxRatePct),
      tax: Number(i.tax),
      total,
      amountPaid: paid,
      balance: i.status === 'VOID' ? 0 : r2(total - paid),
      billTo: i.billTo,
      notes: i.notes,
      issuedAt: i.issuedAt,
      paidAt: i.paidAt,
      voidedAt: i.voidedAt,
      voidReason: i.voidReason,
      payments: (i.payments ?? []).map((p) => ({ id: p.id, amount: Number(p.amount), paidOn: p.paidOn, method: p.method, reference: p.reference, note: p.note, createdAt: p.createdAt })),
      createdAt: i.createdAt,
    };
  }

  /** In-app notice to the organization's members who can see billing. */
  private async tell(organizationId: string, input: { type: string; title: string; body: string }, transaction: Transaction) {
    const permission = await Permission.findOne({ where: { key: 'billing.view' }, attributes: ['id'], transaction });
    if (!permission) return;
    const roleIds = (await RolePermission.findAll({ where: { permissionId: permission.id, organizationId }, attributes: ['roleId'], transaction, ...PLATFORM })).map((r) => r.roleId);
    if (!roleIds.length) return;
    const membershipIds = (await MembershipRole.findAll({ where: { roleId: roleIds, organizationId }, attributes: ['membershipId'], transaction, ...PLATFORM })).map((m) => m.membershipId);
    const members = membershipIds.length ? await OrganizationMembership.findAll({ where: { id: membershipIds, organizationId, status: 'ACTIVE' }, attributes: ['userId'], transaction, ...PLATFORM }) : [];
    for (const userId of new Set(members.map((m) => m.userId))) await this.notifications.notify(userId, { ...input, organizationId, link: '/admin/organization#billing' }, transaction);
  }

  private async emailInvoice(invoiceId: string) {
    const invoice = await Invoice.findByPk(invoiceId, { ...PLATFORM });
    if (!invoice || invoice.status === 'DRAFT' || invoice.status === 'VOID' || !invoice.number) return;
    const [org, sub] = await Promise.all([this.org(invoice.organizationId), OrganizationSubscription.findOne({ where: { organizationId: invoice.organizationId }, ...PLATFORM })]);
    if (!sub?.billingEmail) return;
    const { buffer, fileName } = await this.pdf(invoiceId);
    await this.mail.send(
      invoiceEmail(sub.billingEmail, org.name, invoice.number, amountLabel(Number(invoice.total) - Number(invoice.amountPaid), invoice.currency), dayLabel(invoice.dueDate!), `${this.config.get('APP_URL')}/admin/organization#billing`, {
        filename: fileName,
        content: buffer.toString('base64'),
      }),
    );
  }
}
