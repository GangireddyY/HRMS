import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { csvCell } from '../../common/utils/csv';
import { fullName } from '../../common/utils/names';
import { Designation, Employee, Organization, PayrollRun, Payslip, TaxDeclarationProof, type PayslipLine } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { PayrollConfigService } from './payroll-config.service';
import { ageOn, monthlyTds, type TaxFigures } from './payroll-engine';
import { periodLabel, proofsApply, type VerifiedDeductions } from './payroll-period';
import { SalariesService } from './salaries.service';
import { StatutoryRatesService } from './statutory-rates.service';
import { form12bbHtml, form16Html, type Form16Data } from './statutory-documents';

const QUARTERS = [
  { key: 'Q1', label: 'Q1 (April–June)', months: [4, 5, 6] },
  { key: 'Q2', label: 'Q2 (July–September)', months: [7, 8, 9] },
  { key: 'Q3', label: 'Q3 (October–December)', months: [10, 11, 12] },
  { key: 'Q4', label: 'Q4 (January–March)', months: [1, 2, 3] },
] as const;
export type Quarter = (typeof QUARTERS)[number]['key'];

const amount = (lines: PayslipLine[], code: string) => lines.find((l) => l.code === code)?.amount ?? 0;
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const fyWhere = (fy: number) => ({
  [Op.or]: [
    { year: fy, month: { [Op.gte]: 4 } },
    { year: fy + 1, month: { [Op.lte]: 3 } },
  ],
});
const ddmmyyyy = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const iso = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

/**
 * India statutory outputs from approved payroll: Form 16 Part B per employee, Form 12BB, the 24Q quarterly TDS
 * deductee list, and the monthly ESI and professional-tax / labour-welfare returns.
 */
@Injectable()
export class StatutoryService {
  constructor(
    private readonly audit: AuditService,
    private readonly crypto: EncryptionService,
    private readonly config: PayrollConfigService,
    private readonly salaries: SalariesService,
    private readonly statutoryRates: StatutoryRatesService,
  ) {}

  // ---- Form 16 ---------------------------------------------------------------------------------

  /** The year's tax computation from approved payslips (null when nothing was paid in the year). */
  async form16(auth: AuthContext, employeeId: string | null, fy: number): Promise<Form16Data | null> {
    const employee = await this.salaries.declarationOwner(auth, employeeId);
    const slips = await this.approvedSlips([employee.id], fy);
    if (!slips.length) return null;
    const [org, settings, declaration, designation] = await Promise.all([
      Organization.findByPk(auth.organizationId!, { attributes: ['name', 'addressLine1', 'city', 'state', 'postalCode'] }),
      this.config.settings(auth.organizationId!),
      this.salaries.declaration(employee.id, fy),
      employee.designationId ? Designation.findByPk(employee.designationId, { attributes: ['name'] }) : null,
    ]);
    const figures = slips.reduce<TaxFigures & { tds: number; gross: number }>(
      (acc, p) => {
        const f = (p.tax as { figures?: TaxFigures } | null)?.figures;
        return {
          taxable: acc.taxable + (f?.taxable ?? 0),
          basic: acc.basic + (f?.basic ?? 0),
          hra: acc.hra + (f?.hra ?? 0),
          employeePf: acc.employeePf + (f?.employeePf ?? 0),
          professionalTax: acc.professionalTax + (f?.professionalTax ?? 0),
          tds: acc.tds + amount(p.deductions, 'TDS'),
          gross: acc.gross + Number(p.gross),
        };
      },
      { taxable: 0, basic: 0, hra: 0, employeePf: 0, professionalTax: 0, tds: 0, gross: 0 },
    );
    // Year-end: what was proven counts when proofs are required (March is always at or after the cut-off).
    const verified = proofsApply(settings.proofsFromMonth, 3) ? await this.verified(employee.id, fy) : null;
    const zero: TaxFigures = { taxable: 0, basic: 0, hra: 0, employeePf: 0, professionalTax: 0 };
    const taxRules = await this.statutoryRates.taxRules(fy).catch(() => undefined);
    const result = monthlyTds({
      taxRules,
      fy,
      age: ageOn(employee.dateOfBirth, `${fy + 1}-03-31`),
      declaration: {
        ...declaration,
        ...(verified ? { section80c: verified['80C'], section80ccd1b: verified['80CCD1B'], section80d: verified['80D'], homeLoanInterest: verified.HOME_LOAN, rentPaidAnnual: verified.HRA } : {}),
      },
      ytd: { taxable: figures.taxable, basic: figures.basic, hra: figures.hra, employeePf: figures.employeePf, professionalTax: figures.professionalTax, tds: figures.tds },
      current: zero,
      recurring: zero,
      remainingMonths: 0,
    });
    const run = (p: Payslip) => p.run!;
    const first = slips.map(run).sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))[0]!;
    const last = slips.map(run).sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0]!;
    const pan = employee.panEncrypted ? this.crypto.decrypt(employee.panEncrypted, fields.employee('pan', employee.id)) : null;
    const address = org ? [org.addressLine1, org.city, org.state, org.postalCode].filter(Boolean).join(', ') : null;
    return {
      financialYear: fy,
      employer: { name: org?.name ?? '', tan: settings.tan, address: address || null },
      employee: {
        name: fullName(employee),
        employeeCode: employee.employeeCode,
        pan,
        designation: designation?.name ?? null,
        periodFrom: [employee.dateOfJoining, `${first.year}-${String(first.month).padStart(2, '0')}-01`].sort().at(-1)!,
        periodTo:
          employee.exitDate && employee.exitDate <= `${fy + 1}-03-31`
            ? employee.exitDate
            : `${last.year}-${String(last.month).padStart(2, '0')}-${new Date(Date.UTC(last.year, last.month, 0)).getUTCDate()}`,
      },
      regime: declaration.regime,
      grossSalary: Math.round(figures.taxable),
      previousEmployerIncome: declaration.previousEmployerIncome,
      hraExemption: result.hraExemption,
      standardDeduction: result.standardDeduction,
      professionalTax: result.deductions.professionalTax,
      deductions: {
        section80c: result.deductions.section80c,
        section80ccd1b: result.deductions.section80ccd1b,
        section80d: result.deductions.section80d,
        homeLoanInterest: result.deductions.homeLoanInterest,
      },
      taxableIncome: result.tax.taxableIncome,
      slabTax: result.tax.slabTax,
      rebate: result.tax.rebate,
      surcharge: result.tax.surcharge,
      cess: result.tax.cess,
      totalTax: result.tax.total,
      tdsDeducted: Math.round(figures.tds),
      previousEmployerTds: declaration.previousEmployerTds,
      quarters: QUARTERS.map((q) => {
        const inQ = slips.filter((p) => (q.months as readonly number[]).includes(run(p).month));
        return {
          quarter: q.label,
          amountPaid: Math.round(inQ.reduce((n, p) => n + ((p.tax as { figures?: TaxFigures } | null)?.figures?.taxable ?? Number(p.gross)), 0)),
          tds: inQ.reduce((n, p) => n + amount(p.deductions, 'TDS'), 0),
        };
      }),
    };
  }

  async form16Document(auth: AuthContext, employeeId: string | null, fy: number) {
    const data = await this.form16(auth, employeeId, fy);
    if (!data) throw AppError.notFound(`Approved payroll for FY ${fy}-${(fy + 1) % 100}`);
    const own = (await this.salaries.declarationOwner(auth, null).catch(() => null))?.employeeCode === data.employee.employeeCode;
    if (!own) {
      await this.audit.record({ action: 'payroll.form16_generated', entityType: 'Employee', summary: `Form 16 for FY ${fy}-${(fy + 1) % 100} generated for ${data.employee.employeeCode}` });
    }
    return { fileName: `form16-${data.employee.employeeCode}-${fy}-${(fy + 1) % 100}.html`, html: form16Html(data) };
  }

  // ---- Form 12BB -------------------------------------------------------------------------------

  async form12bb(auth: AuthContext, employeeId: string | null, fy: number) {
    const employee = await this.salaries.declarationOwner(auth, employeeId);
    const [org, declaration, proofs] = await Promise.all([
      Organization.findByPk(auth.organizationId!, { attributes: ['name'] }),
      this.salaries.declaration(employee.id, fy),
      TaxDeclarationProof.findAll({ where: { employeeId: employee.id, financialYear: fy }, order: [['createdAt', 'ASC']] }),
    ]);
    const pan = employee.panEncrypted ? this.crypto.decrypt(employee.panEncrypted, fields.employee('pan', employee.id)) : null;
    const html = form12bbHtml({
      financialYear: fy,
      employee: { name: fullName(employee), employeeCode: employee.employeeCode, pan, address: null },
      employer: { name: org?.name ?? '' },
      regime: declaration.regime,
      rentPaidAnnual: declaration.rentPaidAnnual,
      metroCity: declaration.metroCity,
      homeLoanInterest: declaration.homeLoanInterest,
      section80c: declaration.section80c,
      section80ccd1b: declaration.section80ccd1b,
      section80d: declaration.section80d,
      proofs: proofs.map((p) => ({
        section: p.section,
        description: p.description,
        amount: Number(p.amount),
        status: p.status,
        acceptedAmount: p.acceptedAmount === null ? null : Number(p.acceptedAmount),
      })),
    });
    return { fileName: `form12bb-${employee.employeeCode}-${fy}-${(fy + 1) % 100}.html`, html };
  }

  // ---- 24Q -------------------------------------------------------------------------------------

  /** Annexure I of the quarterly TDS return on salary: one line per employee per month paid (PAN decrypted, audited). */
  async tds24q(fy: number, quarter: Quarter): Promise<{ fileName: string; content: string; rows: number }> {
    const q = QUARTERS.find((x) => x.key === quarter)!;
    const year = (m: number) => (m >= 4 ? fy : fy + 1);
    const runs = await PayrollRun.findAll({
      where: { status: ['APPROVED', 'PAID'], [Op.or]: q.months.map((m) => ({ year: year(m), month: m })) },
      order: [
        ['year', 'ASC'],
        ['month', 'ASC'],
      ],
    });
    const slips = runs.length ? await Payslip.findAll({ where: { runId: runs.map((r) => r.id), excluded: false }, order: [['createdAt', 'ASC']] }) : [];
    const employees = new Map(
      (await Employee.findAll({ where: { id: [...new Set(slips.map((p) => p.employeeId))] }, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'panEncrypted'] })).map((e) => [e.id, e]),
    );
    const runBy = new Map(runs.map((r) => [r.id, r]));
    const rows: unknown[][] = [];
    for (const p of slips) {
      const e = employees.get(p.employeeId);
      const r = runBy.get(p.runId)!;
      if (!e) continue;
      const tds = amount(p.deductions, 'TDS');
      const paid = (p.tax as { figures?: TaxFigures } | null)?.figures?.taxable ?? Number(p.gross);
      const pan = e.panEncrypted ? this.crypto.decrypt(e.panEncrypted, fields.employee('pan', e.id)) : 'PANNOTAVBL';
      const paidOn = r.paidAt ?? new Date(Date.UTC(r.year, r.month, 0));
      rows.push([
        '192',
        e.employeeCode,
        pan,
        fullName(e).toUpperCase(),
        ddmmyyyy(paidOn),
        Math.round(paid),
        tds,
        0,
        0,
        tds,
        ddmmyyyy(paidOn),
        pan === 'PANNOTAVBL' && tds ? 'C' : '',
        periodLabel(r.year, r.month),
      ]);
    }
    await this.audit.record({
      action: 'payroll.tds_24q_exported',
      entityType: 'PayrollRun',
      summary: `24Q ${quarter} FY ${fy}-${(fy + 1) % 100} deductee details exported (${rows.length} lines)`,
      metadata: { fy, quarter, rows: rows.length },
    });
    const header = [
      'Section',
      'Employee code',
      'PAN of deductee',
      'Name of deductee',
      'Date of payment / credit',
      'Amount paid / credited',
      'TDS',
      'Surcharge',
      'Education cess',
      'Total tax deducted',
      'Date of deduction',
      'Reason for non-deduction / higher deduction',
      'Payroll month',
    ];
    return { fileName: `24q-${fy}-${(fy + 1) % 100}-${quarter.toLowerCase()}.csv`, content: csv(header, rows), rows: rows.length };
  }

  // ---- Monthly returns -------------------------------------------------------------------------

  /** ESIC monthly contribution upload: IP number, name, days paid, wages, and a reason for zero days. */
  async esiReturn(runId: string): Promise<{ fileName: string; content: string; skipped: number }> {
    const run = await this.approvedRun(runId);
    const slips = (await Payslip.findAll({ where: { runId, excluded: false } })).filter((p) => (p.statutory as { esiCovered?: boolean }).esiCovered);
    const employees = new Map(
      (await Employee.findAll({ where: { id: slips.map((p) => p.employeeId) }, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'esiNumber', 'exitDate'] })).map((e) => [e.id, e]),
    );
    let skipped = 0;
    const rows: unknown[][] = [];
    for (const p of slips) {
      const e = employees.get(p.employeeId);
      if (!e?.esiNumber) {
        skipped++;
        continue;
      }
      const days = Math.round(Number(p.payableDays));
      const wages = Math.round((p.statutory as { esiWage?: number }).esiWage ?? 0);
      const left = e.exitDate && e.exitDate.startsWith(`${run.year}-${String(run.month).padStart(2, '0')}`);
      // ESIC reason codes: 2 = left service (with the last working day), 1 = on leave.
      const reason = days === 0 ? (left ? 2 : 1) : left ? 2 : 0;
      rows.push([
        e.esiNumber,
        fullName(e).toUpperCase(),
        days,
        wages,
        reason,
        left ? ddmmyyyy(e.exitDate) : '',
        e.employeeCode,
        amount(p.deductions, 'ESI'),
        amount(p.employerContributions, 'ESI_ER'),
      ]);
    }
    await this.audit.record({
      action: 'payroll.esi_return_exported',
      entityType: 'PayrollRun',
      entityId: runId,
      summary: `ESI return for ${periodLabel(run.year, run.month)} exported (${rows.length} members)`,
      metadata: { members: rows.length, skipped },
    });
    const header = [
      'IP Number',
      'IP Name',
      'No of Days for which wages paid/payable during the month',
      'Total Monthly Wages',
      'Reason Code for Zero workings days',
      'Last Working Day',
      'Employee code',
      'Employee contribution',
      'Employer contribution',
    ];
    return { fileName: `esi-return-${run.year}-${String(run.month).padStart(2, '0')}.csv`, content: csv(header, rows), skipped };
  }

  /** Professional tax and labour welfare fund deducted per employee, with totals per state (for the state returns). */
  async stateLevies(runId: string): Promise<{ fileName: string; content: string }> {
    const run = await this.approvedRun(runId);
    const slips = (await Payslip.findAll({ where: { runId, excluded: false } })).filter((p) => amount(p.deductions, 'PT') || amount(p.deductions, 'LWF'));
    const rows = slips.map((p) => {
      const s = p.statutory as { ptState?: string | null; lwfState?: string | null; salaryGross?: number };
      const employee = p.employee as { name?: string; employeeCode?: string };
      return [
        employee.employeeCode,
        employee.name,
        Math.round(s.salaryGross ?? Number(p.gross)),
        s.ptState ?? '',
        amount(p.deductions, 'PT'),
        s.lwfState ?? '',
        amount(p.deductions, 'LWF'),
        amount(p.employerContributions, 'LWF_ER'),
      ];
    });
    const totals = new Map<string, { pt: number; ptCount: number; lwf: number; lwfEmployer: number; lwfCount: number }>();
    for (const r of rows) {
      const [, , , ptState, pt, lwfState, lwf, lwfEr] = r as [string, string, number, string, number, string, number, number];
      if (ptState) {
        const t = totals.get(ptState) ?? { pt: 0, ptCount: 0, lwf: 0, lwfEmployer: 0, lwfCount: 0 };
        totals.set(ptState, { ...t, pt: t.pt + pt, ptCount: t.ptCount + (pt ? 1 : 0) });
      }
      if (lwfState) {
        const t = totals.get(lwfState) ?? { pt: 0, ptCount: 0, lwf: 0, lwfEmployer: 0, lwfCount: 0 };
        totals.set(lwfState, { ...t, lwf: t.lwf + lwf, lwfEmployer: t.lwfEmployer + lwfEr, lwfCount: t.lwfCount + (lwf ? 1 : 0) });
      }
    }
    const summary = [...totals].map(([state, t]) => ['TOTAL', state, '', state, t.pt, state, t.lwf, t.lwfEmployer]);
    const header = ['Employee code', 'Name', 'Gross salary', 'Professional tax state', 'Professional tax', 'Labour welfare fund state', 'LWF (employee)', 'LWF (employer)'];
    return { fileName: `state-levies-${run.year}-${String(run.month).padStart(2, '0')}.csv`, content: csv(header, [...rows, ...summary]) };
  }

  /** Statutory totals of a run, for the run page. */
  async summary(runId: string) {
    const run = await PayrollRun.findByPk(runId);
    if (!run) throw AppError.notFound('Payroll run');
    const slips = await Payslip.findAll({ where: { runId, excluded: false }, attributes: ['deductions', 'employerContributions', 'statutory'] });
    const sum = (pick: (p: Payslip) => number) => slips.reduce((n, p) => n + pick(p), 0);
    const byState = (code: 'PT' | 'LWF', key: 'ptState' | 'lwfState') => {
      const out = new Map<string, number>();
      for (const p of slips) {
        const v = amount(p.deductions, code);
        const state = (p.statutory as Record<string, string | null>)[key];
        if (v && state) out.set(state, (out.get(state) ?? 0) + v);
      }
      return [...out].map(([state, total]) => ({ state, total }));
    };
    return {
      pf: {
        employee: sum((p) => amount(p.deductions, 'PF')),
        employer: sum((p) => amount(p.employerContributions, 'EPF') + amount(p.employerContributions, 'EPS')),
        members: slips.filter((p) => amount(p.deductions, 'PF')).length,
      },
      esi: {
        employee: sum((p) => amount(p.deductions, 'ESI')),
        employer: sum((p) => amount(p.employerContributions, 'ESI_ER')),
        members: slips.filter((p) => (p.statutory as { esiCovered?: boolean }).esiCovered).length,
      },
      professionalTax: byState('PT', 'ptState'),
      labourWelfare: { employee: byState('LWF', 'lwfState'), employer: sum((p) => amount(p.employerContributions, 'LWF_ER')) },
      tds: sum((p) => amount(p.deductions, 'TDS')),
    };
  }

  private async approvedRun(id: string) {
    const run = await PayrollRun.findByPk(id);
    if (!run) throw AppError.notFound('Payroll run');
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw AppError.conflict('Statutory returns are available once the payroll is approved');
    return run;
  }

  private async approvedSlips(employeeIds: string[], fy: number) {
    return Payslip.findAll({
      where: { employeeId: employeeIds, excluded: false },
      include: [{ model: PayrollRun, where: { status: ['APPROVED', 'PAID'], ...fyWhere(fy) }, attributes: ['id', 'year', 'month', 'paidAt'] }],
    });
  }

  private async verified(employeeId: string, fy: number): Promise<VerifiedDeductions> {
    const out: VerifiedDeductions = { '80C': 0, '80CCD1B': 0, '80D': 0, HRA: 0, HOME_LOAN: 0 };
    for (const p of await TaxDeclarationProof.findAll({ where: { employeeId, financialYear: fy, status: 'ACCEPTED' }, attributes: ['section', 'acceptedAmount'] }))
      out[p.section] += Number(p.acceptedAmount);
    return out;
  }
}
