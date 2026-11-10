import { Injectable } from '@nestjs/common';
import { Op, QueryTypes, type Transaction } from 'sequelize';
import { REIMBURSEMENT_CATEGORIES, type ExpensePolicyRule, type ReimbursementCategory } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { ExpensePolicy, PayrollSettings, ReimbursementClaim } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { ExpensePolicyDto } from './dto/payroll.dto';

const COUNTED = ['PENDING', 'APPROVED', 'PAID'];
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const CATEGORY_NAMES: Record<ReimbursementCategory, string> = {
  TRAVEL: 'travel',
  FOOD: 'food',
  INTERNET_PHONE: 'internet & phone',
  MEDICAL: 'medical',
  RELOCATION: 'relocation',
  OFFICE_SUPPLIES: 'office supplies',
  OTHER: 'other',
};

/** First and last day of the calendar month of `date` (YYYY-MM-DD). */
export function monthOf(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/**
 * Expense policy (`payroll.configure`): per category whether it can be claimed, a per-claim and a monthly limit,
 * and above which amount a receipt is required; plus the amount above which a claim also needs a finance approval.
 * Rules are checked when a claim is submitted.
 */
@Injectable()
export class ExpensePolicyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async view(organizationId: string): Promise<{ categories: ExpensePolicyRule[]; financeApprovalAbove: number | null }> {
    const [rows, settings] = await Promise.all([ExpensePolicy.findAll(), PayrollSettings.findByPk(organizationId, { attributes: ['organizationId', 'claimFinanceApprovalAbove'] })]);
    const by = new Map(rows.map((r) => [r.category, r]));
    return {
      categories: REIMBURSEMENT_CATEGORIES.map((category) => {
        const r = by.get(category);
        return { category, allowed: r?.allowed ?? true, perClaimLimit: num(r?.perClaimLimit), monthlyLimit: num(r?.monthlyLimit), receiptRequiredAbove: num(r?.receiptRequiredAbove) };
      }),
      financeApprovalAbove: num(settings?.claimFinanceApprovalAbove),
    };
  }

  async update(auth: AuthContext, dto: ExpensePolicyDto) {
    const issues: { field: string; message: string }[] = [];
    dto.categories.forEach((c, i) => {
      if (c.perClaimLimit && c.monthlyLimit && c.perClaimLimit > c.monthlyLimit) issues.push({ field: `categories.${i}.monthlyLimit`, message: `The ${CATEGORY_NAMES[c.category]} monthly limit is below its per-claim limit` });
    });
    if (new Set(dto.categories.map((c) => c.category)).size !== dto.categories.length) issues.push({ field: 'categories', message: 'Each category appears once' });
    if (issues.length) throw AppError.validation(issues);
    await this.db.transaction(async (transaction) => {
      for (const c of dto.categories) {
        const values = {
          allowed: c.allowed ?? true,
          perClaimLimit: c.perClaimLimit ? String(c.perClaimLimit) : null,
          monthlyLimit: c.monthlyLimit ? String(c.monthlyLimit) : null,
          receiptRequiredAbove: c.receiptRequiredAbove === null || c.receiptRequiredAbove === undefined ? null : String(c.receiptRequiredAbove),
          updatedById: auth.userId,
        };
        const row = await ExpensePolicy.findOne({ where: { category: c.category }, transaction, lock: transaction.LOCK.UPDATE });
        if (row) await row.update(values, { transaction });
        else await ExpensePolicy.create({ organizationId: auth.organizationId!, category: c.category, ...values }, { transaction });
      }
      if (dto.financeApprovalAbove !== undefined) {
        const value = dto.financeApprovalAbove ? String(dto.financeApprovalAbove) : null;
        const row = await PayrollSettings.findByPk(auth.organizationId!, { transaction, lock: transaction.LOCK.UPDATE });
        if (row) await row.update({ claimFinanceApprovalAbove: value, updatedById: auth.userId }, { transaction });
        else await PayrollSettings.create({ organizationId: auth.organizationId!, claimFinanceApprovalAbove: value, updatedById: auth.userId }, { transaction });
      }
      await this.audit.record(
        {
          action: 'payroll.expense_policy_updated',
          entityType: 'ExpensePolicy',
          entityId: auth.organizationId!,
          summary: `Expense policy updated${dto.financeApprovalAbove ? ` (finance approval above ${money(dto.financeApprovalAbove)})` : ''}`,
          metadata: { categories: dto.categories, financeApprovalAbove: dto.financeApprovalAbove ?? null },
        },
        transaction,
      );
    });
    return this.view(auth.organizationId!);
  }

  /** An employee's claimed amounts per category in the month of `date` (pending, approved and paid). */
  async usage(employeeId: string, date: string, transaction?: Transaction): Promise<Record<ReimbursementCategory, number>> {
    const { from, to } = monthOf(date);
    const rows = (await ReimbursementClaim.findAll({
      where: { employeeId, status: COUNTED, expenseDate: { [Op.between]: [from, to] } },
      attributes: ['category', 'amount'],
      transaction,
    })) as ReimbursementClaim[];
    const out = Object.fromEntries(REIMBURSEMENT_CATEGORIES.map((c) => [c, 0])) as Record<ReimbursementCategory, number>;
    for (const r of rows) out[r.category] = Math.round((out[r.category] + Number(r.amount)) * 100) / 100;
    return out;
  }

  /** Rules that don't depend on other claims: category allowed, per-claim limit, receipt. */
  async checkClaim(organizationId: string, category: ReimbursementCategory, amount: number, hasReceipt: boolean): Promise<void> {
    const rule = (await this.view(organizationId)).categories.find((c) => c.category === category)!;
    const name = CATEGORY_NAMES[category];
    if (!rule.allowed) throw AppError.validation([{ field: 'category', message: `${name[0]!.toUpperCase()}${name.slice(1)} expenses can't be claimed` }]);
    if (rule.perClaimLimit !== null && amount > rule.perClaimLimit) throw AppError.validation([{ field: 'amount', message: `The limit for ${name} is ${money(rule.perClaimLimit)} per claim` }]);
    if (rule.receiptRequiredAbove !== null && amount > rule.receiptRequiredAbove && !hasReceipt) {
      throw AppError.validation([{ field: 'file', message: rule.receiptRequiredAbove === 0 ? `Attach a receipt for ${name} claims` : `Attach a receipt for ${name} claims above ${money(rule.receiptRequiredAbove)}` }]);
    }
  }

  /** Monthly limit, checked inside the claim's transaction (serialized per employee). */
  async checkMonthly(organizationId: string, employeeId: string, category: ReimbursementCategory, expenseDate: string, amount: number, transaction: Transaction): Promise<void> {
    const rule = (await this.view(organizationId)).categories.find((c) => c.category === category)!;
    if (rule.monthlyLimit === null) return;
    await this.db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key: `claims:${employeeId}` }, type: QueryTypes.SELECT, transaction });
    const used = (await this.usage(employeeId, expenseDate, transaction))[category];
    if (used + amount > rule.monthlyLimit) {
      const left = Math.max(0, rule.monthlyLimit - used);
      const month = new Date(`${expenseDate.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      throw AppError.validation([
        { field: 'amount', message: `The ${CATEGORY_NAMES[category]} limit is ${money(rule.monthlyLimit)} a month; ${left ? `${money(left)} is left for ${month}` : `it is used up for ${month}`}` },
      ]);
    }
  }

  async financeThreshold(organizationId: string, transaction?: Transaction): Promise<number | null> {
    const s = await PayrollSettings.findByPk(organizationId, { attributes: ['organizationId', 'claimFinanceApprovalAbove'], transaction });
    return num(s?.claimFinanceApprovalAbove);
  }
}
