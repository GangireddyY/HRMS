import { Injectable } from '@nestjs/common';
import type { AccountingSettingsView, LedgerSlot, PayrollJournal } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { AccountingSettings, Organization, PayGroup, PayrollRun, Payslip, SalaryComponentDef } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import { buildJournal, ENGINE_EARNINGS, tallyMastersXml, tallyVoucherXml, withDefaults } from './accounting-journal';
import type { AccountingSettingsDto } from './dto/accounting.dto';
import { periodLabel } from './payroll-period';

/** Ledger mapping and the accounting journal of an approved payroll run, with its Tally import files. */
@Injectable()
export class AccountingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async settings(organizationId: string): Promise<AccountingSettingsView> {
    return withDefaults(await AccountingSettings.findByPk(organizationId));
  }

  async update(auth: AuthContext, dto: AccountingSettingsDto): Promise<AccountingSettingsView> {
    const before = await this.settings(auth.organizationId!);
    if (dto.earningLedgers?.length) {
      const known = new Set([...(await SalaryComponentDef.findAll({ attributes: ['code'] })).map((c) => c.code), ...ENGINE_EARNINGS]);
      const unknown = dto.earningLedgers.filter((e) => !known.has(e.code)).map((e) => e.code);
      if (unknown.length) throw AppError.validation([{ field: 'earningLedgers', message: `Unknown earning ${unknown.length === 1 ? 'code' : 'codes'}: ${unknown.join(', ')}` }]);
    }
    const next: AccountingSettingsView = {
      tallyCompany: dto.tallyCompany !== undefined ? dto.tallyCompany : before.tallyCompany,
      voucherType: dto.voucherType ?? before.voucherType,
      costCentres: dto.costCentres ?? before.costCentres,
      costCategory: dto.costCategory ?? before.costCategory,
      ledgers: dto.ledgers ? { ...before.ledgers, ...Object.fromEntries(dto.ledgers.map((l) => [l.slot, l.name])) } : before.ledgers,
      earningLedgers: dto.earningLedgers ? Object.fromEntries(dto.earningLedgers.map((e) => [e.code, e.name])) : before.earningLedgers,
    };
    await this.db.transaction(async (transaction) => {
      const values = { ...next, ledgers: next.ledgers as Partial<Record<LedgerSlot, string>>, updatedById: auth.userId };
      const row = await AccountingSettings.findByPk(auth.organizationId!, { transaction, lock: transaction.LOCK.UPDATE });
      if (row) await row.update(values, { transaction });
      else await AccountingSettings.create({ organizationId: auth.organizationId!, ...values }, { transaction });
      await this.audit.record(
        {
          action: 'payroll.accounting_updated',
          entityType: 'AccountingSettings',
          summary: 'Accounting ledgers for payroll updated',
          changes: diff(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>),
        },
        transaction,
      );
    });
    return this.settings(auth.organizationId!);
  }

  /** The run's journal (approved and paid runs only: unapproved figures still change). */
  async journal(runId: string): Promise<PayrollJournal & { settings: AccountingSettingsView; groups: ReturnType<typeof buildJournal>['groups'] }> {
    const run = await PayrollRun.findByPk(runId);
    if (!run) throw AppError.notFound('Payroll run');
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw AppError.conflict('The accounting journal is available once the payroll is approved');
    const [settings, payslips, org, group] = await Promise.all([
      this.settings(run.organizationId),
      Payslip.findAll({ where: { runId, excluded: false }, attributes: ['employee', 'currency', 'earnings', 'deductions', 'employerContributions'] }),
      Organization.findByPk(run.organizationId, { attributes: ['currency'] }),
      run.payGroupId ? PayGroup.findByPk(run.payGroupId, { attributes: ['name'] }) : null,
    ]);
    const currencies = [...new Set(payslips.map((p) => p.currency ?? org?.currency ?? 'INR'))];
    if (currencies.length > 1) throw AppError.conflict(`This run pays in ${currencies.join(' and ')}; export each pay group's run separately`);
    const { lines, groups } = buildJournal(
      payslips.map((p) => ({ department: (p.employee.department as string | null) ?? null, earnings: p.earnings, deductions: p.deductions, employerContributions: p.employerContributions })),
      settings,
    );
    const last = new Date(Date.UTC(run.year, run.month, 0)).toISOString().slice(0, 10);
    const period = periodLabel(run.year, run.month);
    const total = (k: 'debit' | 'credit') => Math.round(lines.reduce((n, l) => n + l[k] * 100, 0)) / 100;
    return {
      runId,
      period,
      date: last,
      currency: currencies[0] ?? org?.currency ?? 'INR',
      narration: `Salary for ${period}${group ? ` (${group.name})` : ''}, ${payslips.length} employee${payslips.length === 1 ? '' : 's'}`,
      lines,
      totalDebit: total('debit'),
      totalCredit: total('credit'),
      payslips: payslips.length,
      settings,
      groups,
    };
  }

  async preview(runId: string): Promise<PayrollJournal> {
    const { settings: _s, groups: _g, ...journal } = await this.journal(runId);
    return journal;
  }

  async tally(runId: string, part: 'vouchers' | 'masters' = 'vouchers'): Promise<{ fileName: string; content: string }> {
    const j = await this.journal(runId);
    if (!j.lines.length) throw AppError.conflict('This run has nothing to post');
    const content =
      part === 'masters' ? tallyMastersXml(j.lines, j.groups, j.settings) : tallyVoucherXml({ remoteId: `hrms-payroll-${runId}`, date: j.date, narration: j.narration, lines: j.lines }, j.settings);
    await this.audit.record({
      action: 'payroll.tally_exported',
      entityType: 'PayrollRun',
      entityId: runId,
      summary: `Tally ${part === 'masters' ? 'ledger masters' : 'journal'} for ${j.period} exported`,
      metadata: { part, lines: j.lines.length, total: j.totalDebit },
    });
    const [year, month] = j.date.split('-');
    return { fileName: `tally-${part === 'masters' ? 'masters' : 'journal'}-${year}-${month}.xml`, content };
  }
}
