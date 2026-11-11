import { Injectable,type OnModuleInit } from '@nestjs/common';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import {
Employee,
Organization,
PayrollAdjustment,
PayrollRun,
Payslip,
User
} from '../../database/models';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { payslipEmail } from '../../infrastructure/mail/templates';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { PayrollConfigService } from './payroll-config.service';
import { periodLabel } from './payroll-period';
import { userIdsOfEmployees } from './payroll-recipients';
import { payslipPdf,type PayslipPdfInput } from './payslip-pdf';

export const PAYSLIP_EMAIL_JOB = 'payroll.payslip_email';

/** Payslips: who may see one, the PDF, the emailed copy (a background job) and the employee's own list. */
@Injectable()
export class PayslipsService implements OnModuleInit {
  constructor(
    private readonly scope: EmployeeScopeService,
    private readonly config: PayrollConfigService,
    private readonly jobs: JobQueueService,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ payslipId: string }>(PAYSLIP_EMAIL_JOB, (payload) => this.emailPayslip(payload));
  }

  /**
   * One payslip. Published payslips (approved / paid runs, not held) are visible to the employee and within
   * `payroll.payslip.view` scope; `payroll.view` sees every payslip, including drafts.
   */
  async payslip(auth: AuthContext, id: string) {
    const p = await Payslip.findByPk(id, { include: [{ model: PayrollRun }] });
    if (!p) throw AppError.notFound('Payslip');
    const published = (p.run!.status === 'APPROVED' || p.run!.status === 'PAID') && !p.excluded;
    const isHr = auth.permissions.has('payroll.view');
    if (!isHr) {
      const employee = await Employee.findByPk(p.employeeId, { attributes: ['id', 'managerId', 'departmentId'] });
      if (!published || !employee || !(await this.scope.covers(auth, 'payroll.payslip.view', employee))) throw AppError.notFound('Payslip');
    }
    const adjustments = isHr ? await PayrollAdjustment.findAll({ where: { runId: p.runId, employeeId: p.employeeId }, order: [['createdAt', 'ASC']] }) : [];
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['name', 'legalName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'logoUrl'] });
    return {
      ...this.present(p, p.run!, true),
      organization: org
        ? { name: org.legalName || org.name, address: [org.addressLine1, org.addressLine2, org.city, org.state, org.postalCode].filter(Boolean).join(', ') || null, logoUrl: org.logoUrl }
        : null,
      adjustments: adjustments.map((a) => ({ id: a.id, kind: a.kind, label: a.label, amount: Number(a.amount), taxable: a.taxable })),
    };
  }

  /** The payslip as a PDF (same access as the payslip). */
  async payslipPdfFile(auth: AuthContext, id: string): Promise<{ fileName: string; data: Buffer }> {
    const p = await this.payslip(auth, id);
    const employee = p.employee as { name: string; employeeCode: string };
    return { fileName: `payslip-${p.year}-${String(p.month).padStart(2, '0')}-${employee.employeeCode}.pdf`, data: await payslipPdf(this.pdfInput(p, p.organization)) };
  }

  /** Background job: emails one payslip PDF to the employee (password-protected per payroll setup). */
  private async emailPayslip(payload: { payslipId: string }): Promise<void> {
    const p = await Payslip.findByPk(payload.payslipId, { include: [{ model: PayrollRun }] });
    if (!p || p.excluded || !p.run || !['APPROVED', 'PAID'].includes(p.run.status)) return;
    const employee = await Employee.findByPk(p.employeeId, { attributes: ['id', 'firstName', 'lastName', 'dateOfBirth', 'membershipId', 'employeeCode'] });
    if (!employee) return;
    const userId = (await userIdsOfEmployees([employee.id])).get(employee.id);
    const user = userId ? await User.findByPk(userId, { attributes: ['email', 'status'] }) : null;
    if (!user?.email || user.status !== 'ACTIVE') return;
    const [settings, org] = await Promise.all([
      this.config.settings(p.organizationId),
      Organization.findByPk(p.organizationId, { attributes: ['name', 'legalName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'] }),
    ]);
    const dob = settings.payslipPdfPassword === 'DOB' && employee.dateOfBirth ? `${employee.dateOfBirth.slice(8, 10)}${employee.dateOfBirth.slice(5, 7)}${employee.dateOfBirth.slice(0, 4)}` : undefined;
    const orgName = org ? org.legalName || org.name : '';
    const presented = { ...this.present(p, p.run, true), organization: org ? { name: orgName, address: [org.addressLine1, org.addressLine2, org.city, org.state, org.postalCode].filter(Boolean).join(', ') || null } : null };
    const pdf = await payslipPdf(this.pdfInput(presented, presented.organization), { password: dob });
    const period = periodLabel(p.run.year, p.run.month);
    await this.mail.send(
      payslipEmail(user.email, employee.firstName, orgName, period, `₹${Number(p.netPay).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, dob ? 'your date of birth (DDMMYYYY)' : null, {
        filename: `payslip-${p.run.year}-${String(p.run.month).padStart(2, '0')}.pdf`,
        content: pdf.toString('base64'),
      }),
    );
  }

  private pdfInput(p: ReturnType<PayslipsService['present']>, organization: { name: string; address: string | null } | null): PayslipPdfInput {
    const e = p.employee as PayslipPdfInput['employee'];
    return {
      organization,
      period: p.period ?? '',
      employee: e,
      daysInMonth: p.daysInMonth,
      payableDays: p.payableDays,
      lopDays: p.lopOverride ?? p.lopDays,
      earnings: (p.earnings ?? []).filter((l) => l.amount),
      deductions: (p.deductions ?? []).filter((l) => l.amount),
      employerContributions: (p.employerContributions ?? []).filter((l) => l.amount),
      gross: p.gross,
      totalDeductions: p.totalDeductions,
      netPay: p.netPay,
      currency: p.currency,
    };
  }

  async myPayslips(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const rows = await Payslip.findAll({
      where: { employeeId: self.id, excluded: false },
      include: [{ model: PayrollRun, where: { status: ['APPROVED', 'PAID'] }, attributes: ['id', 'year', 'month', 'status', 'paidAt'] }],
      order: [
        ['run', 'year', 'DESC'],
        ['run', 'month', 'DESC'],
      ],
    });
    return rows.map((p) => ({
      id: p.id,
      year: p.run!.year,
      month: p.run!.month,
      period: periodLabel(p.run!.year, p.run!.month),
      status: p.run!.status,
      paidAt: p.run!.paidAt,
      gross: Number(p.gross),
      totalDeductions: Number(p.totalDeductions),
      netPay: Number(p.netPay),
      currency: p.currency,
    }));
  }

  present(p: Payslip, run: PayrollRun | null, detail: boolean) {
    return {
      id: p.id,
      runId: p.runId,
      employeeId: p.employeeId,
      employee: p.employee,
      ...(run ? { period: periodLabel(run.year, run.month), year: run.year, month: run.month, runStatus: run.status } : {}),
      daysInMonth: p.daysInMonth,
      employedDays: Number(p.employedDays),
      lopDays: Number(p.lopDays),
      lopOverride: p.lopOverride === null ? null : Number(p.lopOverride),
      payableDays: Number(p.payableDays),
      gross: Number(p.gross),
      totalDeductions: Number(p.totalDeductions),
      netPay: Number(p.netPay),
      /** Null = the organization's currency. */
      currency: p.currency,
      excluded: p.excluded,
      excludeReason: p.excludeReason,
      warnings: p.warnings,
      ...(detail ? { earnings: p.earnings, deductions: p.deductions, employerContributions: p.employerContributions, statutory: p.statutory, tax: p.tax } : {}),
    };
  }
}
