import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import { EMPLOYMENT_TYPES, MAX_REPORT_DAYS, type ReportKey, type ReportTable } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { csvCell } from '../../common/utils/csv';
import { addDays, addMonths } from '../../common/utils/zoned-time';
import {
  ApplicationEvent,
  Department,
  Employee,
  ExitCase,
  Grade,
  JobApplication,
  JobOpening,
  LeaveRequest,
  LeaveType,
  Location,
  Offer,
  PayrollRun,
  Payslip,
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, organizationToday } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import type { ReportQueryDto } from './dto/reports.dto';
import { TENURE_BANDS, attritionRate, completedYears, countBy, daysBetween, employedOn, headcountTrend, leftIn, median, monthsBetween, pct, tenureBand } from './reports-rules';

const PEOPLE = ['id', 'employeeCode', 'firstName', 'lastName', 'dateOfJoining', 'exitDate', 'status', 'departmentId', 'locationId', 'gradeId', 'employmentType', 'gender'];
const TYPE_LABELS: Record<string, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACT: 'Contract', INTERN: 'Intern' };
const GENDER_LABELS: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', NON_BINARY: 'Non-binary', UNDISCLOSED: 'Not disclosed' };
const EXIT_TYPE_LABELS: Record<string, string> = { RESIGNATION: 'Resignation', TERMINATION: 'Termination', RETIREMENT: 'Retirement', CONTRACT_END: 'End of contract', DEATH: 'Death', OTHER: 'Other' };
const EXIT_REASON_LABELS: Record<string, string> = {
  BETTER_OPPORTUNITY: 'A better opportunity',
  COMPENSATION: 'Pay and benefits',
  CAREER_GROWTH: 'Career growth',
  RELOCATION: 'Relocation',
  HIGHER_STUDIES: 'Higher studies',
  PERSONAL: 'Personal reasons',
  HEALTH: 'Health',
  WORK_ENVIRONMENT: 'Work environment',
  MANAGER: 'Manager or team',
  PERFORMANCE: 'Performance',
  MISCONDUCT: 'Misconduct',
  REDUNDANCY: 'Redundancy',
  OTHER: 'Other',
};
const STAGE_LABELS: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' };
const SOURCE_LABELS: Record<string, string> = { CAREERS: 'Careers page', REFERRAL: 'Referral', JOB_BOARD: 'Job board', LINKEDIN: 'LinkedIn', AGENCY: 'Agency', DIRECT: 'Direct', OTHER: 'Other' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
const money = (n: number) => Math.round(n * 100) / 100;

const shareTable = (key: string, title: string, label: string, rows: { name: string; count: number; share: number | null }[]): ReportTable => ({
  key,
  title,
  columns: [
    { key: 'name', label },
    { key: 'count', label: 'People', format: 'number' },
    { key: 'share', label: 'Share', format: 'percent' },
  ],
  rows,
});

/**
 * Reports. HR reports (`reports.view`) cover the employees within the caller's scope (a department manager sees their
 * department); payroll cost (`reports.payroll.view`) and recruitment (`reports.recruitment.view`) are organization-wide.
 * Every report returns its figures as tables, which is also what the CSV export (`reports.export`) contains.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
  ) {}

  async headcount(auth: AuthContext, query: ReportQueryDto) {
    const today = await organizationToday(auth.organizationId!);
    const asOf = query.asOf ?? today;
    if (asOf > today) throw AppError.validation([{ field: 'asOf', message: "The date can't be in the future" }]);
    const people = await this.people(auth, query.departmentId);
    const names = await this.names();
    const current = people.filter((e) => employedOn(e, asOf));
    const tenure = current.map((e) => daysBetween(e.dateOfJoining, asOf) / 365.25);
    const trend = headcountTrend(people, asOf, 12);
    const female = current.filter((e) => e.gender === 'FEMALE').length;
    return {
      asOf,
      summary: {
        headcount: current.length,
        onNotice: current.filter((e) => e.status === 'ON_NOTICE').length,
        joinersLast30Days: people.filter((e) => e.dateOfJoining > addDays(asOf, -30) && e.dateOfJoining <= asOf).length,
        averageTenureYears: tenure.length ? Math.round((tenure.reduce((s, x) => s + x, 0) / tenure.length) * 10) / 10 : null,
        womenShare: pct(female, current.length),
      },
      trend,
      tables: [
        shareTable('department', 'By department', 'Department', countBy(current, (e) => names.department(e.departmentId))),
        shareTable('location', 'By location', 'Location', countBy(current, (e) => names.location(e.locationId))),
        shareTable(
          'type',
          'By employment type',
          'Employment type',
          countBy(current, (e) => TYPE_LABELS[e.employmentType] ?? e.employmentType).sort((a, b) => EMPLOYMENT_TYPES.indexOf(this.typeKey(a.name)) - EMPLOYMENT_TYPES.indexOf(this.typeKey(b.name))),
        ),
        shareTable('gender', 'By gender', 'Gender', countBy(current, (e) => (e.gender ? (GENDER_LABELS[e.gender] ?? e.gender) : 'Not recorded'))),
        shareTable('grade', 'By grade', 'Grade', countBy(current, (e) => names.grade(e.gradeId))),
        {
          key: 'trend',
          title: 'Last 12 months',
          columns: [
            { key: 'month', label: 'Month' },
            { key: 'headcount', label: 'Headcount', format: 'number' },
            { key: 'joiners', label: 'Joiners', format: 'number' },
            { key: 'leavers', label: 'Leavers', format: 'number' },
          ],
          rows: trend.map((t) => ({ month: monthLabel(Number(t.month.slice(0, 4)), Number(t.month.slice(5))), headcount: t.headcount, joiners: t.joiners, leavers: t.leavers })),
        },
      ] satisfies ReportTable[],
    };
  }

  async attrition(auth: AuthContext, query: ReportQueryDto) {
    const today = await organizationToday(auth.organizationId!);
    const { from, to } = this.range(query, today, addMonths(today, -12));
    const people = await this.people(auth, query.departmentId);
    const names = await this.names();
    const startOf = addDays(from, -1);
    const leavers = people.filter((e) => leftIn(e, from, to, today));
    const joiners = people.filter((e) => e.dateOfJoining >= from && e.dateOfJoining <= to);
    const cases = leavers.length ? await ExitCase.findAll({ where: { employeeId: leavers.map((e) => e.id), status: ['APPROVED', 'COMPLETED'] }, attributes: ['employeeId', 'type', 'reason'] }) : [];
    const caseOf = new Map(cases.map((c) => [c.employeeId, c]));
    const start = people.filter((e) => employedOn(e, startOf)).length;
    const end = people.filter((e) => employedOn(e, to < today ? to : today)).length;
    const voluntary = leavers.filter((e) => caseOf.get(e.id)?.type === 'RESIGNATION').length;
    const rate = attritionRate(leavers.length, start, end, daysBetween(from, to) + 1);
    const departments = [...new Set(people.map((e) => e.departmentId))];
    return {
      from,
      to,
      summary: { startHeadcount: start, endHeadcount: end, joiners: joiners.length, leavers: leavers.length, voluntary, involuntary: leavers.length - voluntary, rate: rate.rate, annualizedRate: rate.annualized },
      tables: [
        {
          key: 'department',
          title: 'By department',
          columns: [
            { key: 'name', label: 'Department' },
            { key: 'start', label: 'At start', format: 'number' },
            { key: 'end', label: 'At end', format: 'number' },
            { key: 'joiners', label: 'Joiners', format: 'number' },
            { key: 'leavers', label: 'Leavers', format: 'number' },
            { key: 'rate', label: 'Attrition', format: 'percent' },
          ],
          rows: departments
            .map((d) => {
              const inDept = people.filter((e) => e.departmentId === d);
              const s = inDept.filter((e) => employedOn(e, startOf)).length;
              const n = inDept.filter((e) => employedOn(e, to < today ? to : today)).length;
              const l = leavers.filter((e) => e.departmentId === d).length;
              return { name: names.department(d), start: s, end: n, joiners: joiners.filter((e) => e.departmentId === d).length, leavers: l, rate: attritionRate(l, s, n, 1).rate };
            })
            .filter((r) => r.start || r.end || r.joiners || r.leavers)
            .sort((a, b) => b.leavers - a.leavers || a.name.localeCompare(b.name)),
        },
        shareTable('type', 'By type of exit', 'Exit', countBy(leavers, (e) => EXIT_TYPE_LABELS[caseOf.get(e.id)?.type ?? ''] ?? 'Not recorded')),
        shareTable('reason', 'By reason', 'Reason', countBy(leavers, (e) => EXIT_REASON_LABELS[caseOf.get(e.id)?.reason ?? ''] ?? 'Not recorded')),
        shareTable(
          'tenure',
          'By length of service',
          'Service at exit',
          TENURE_BANDS.map((band) => {
            const count = leavers.filter((e) => tenureBand(e.dateOfJoining, e.exitDate!) === band).length;
            return { name: band, count, share: pct(count, leavers.length) };
          }),
        ),
        {
          key: 'leavers',
          title: 'Leavers',
          columns: [
            { key: 'name', label: 'Employee' },
            { key: 'code', label: 'Code' },
            { key: 'department', label: 'Department' },
            { key: 'exitDate', label: 'Last working day', format: 'date' },
            { key: 'type', label: 'Exit' },
            { key: 'reason', label: 'Reason' },
            { key: 'years', label: 'Years of service', format: 'number' },
          ],
          rows: leavers
            .sort((a, b) => b.exitDate!.localeCompare(a.exitDate!))
            .map((e) => ({
              name: fullName(e),
              code: e.employeeCode,
              department: names.department(e.departmentId),
              exitDate: e.exitDate,
              type: EXIT_TYPE_LABELS[caseOf.get(e.id)?.type ?? ''] ?? 'Not recorded',
              reason: EXIT_REASON_LABELS[caseOf.get(e.id)?.reason ?? ''] ?? 'Not recorded',
              years: completedYears(e.dateOfJoining, e.exitDate!),
            })),
        },
      ] satisfies ReportTable[],
    };
  }

  async leave(auth: AuthContext, query: ReportQueryDto) {
    const today = await organizationToday(auth.organizationId!);
    const { from, to } = this.range(query, today, addMonths(today, -3));
    const people = await this.people(auth, query.departmentId);
    const names = await this.names();
    const byId = new Map(people.map((e) => [e.id, e]));
    const requests = people.length ? await LeaveRequest.findAll({ where: { employeeId: people.map((e) => e.id), startDate: { [Op.between]: [from, to] } }, attributes: ['employeeId', 'leaveTypeId', 'days', 'status'] }) : [];
    const types = new Map((await LeaveType.findAll({ attributes: ['id', 'name'] })).map((t) => [t.id, t.name]));
    const approved = requests.filter((r) => r.status === 'APPROVED');
    const sum = (rs: LeaveRequest[]) => Math.round(rs.reduce((s, r) => s + Number(r.days), 0) * 10) / 10;
    const employed = people.filter((e) => e.dateOfJoining <= to && (!e.exitDate || e.exitDate >= from));
    const typeIds = [...new Set(requests.map((r) => r.leaveTypeId))];
    const departments = [...new Set(employed.map((e) => e.departmentId))];
    const perEmployee = new Map<string, number>();
    for (const r of approved) perEmployee.set(r.employeeId, (perEmployee.get(r.employeeId) ?? 0) + Number(r.days));
    return {
      from,
      to,
      summary: {
        approvedDays: sum(approved),
        requests: requests.length,
        pending: requests.filter((r) => r.status === 'PENDING').length,
        rejected: requests.filter((r) => r.status === 'REJECTED').length,
        peopleOnLeave: perEmployee.size,
        daysPerEmployee: employed.length ? Math.round((sum(approved) / employed.length) * 10) / 10 : null,
      },
      tables: [
        {
          key: 'type',
          title: 'By leave type',
          columns: [
            { key: 'name', label: 'Leave type' },
            { key: 'requests', label: 'Approved requests', format: 'number' },
            { key: 'days', label: 'Days', format: 'number' },
            { key: 'pending', label: 'Pending', format: 'number' },
          ],
          rows: typeIds
            .map((t) => ({ name: types.get(t) ?? 'Unknown', requests: approved.filter((r) => r.leaveTypeId === t).length, days: sum(approved.filter((r) => r.leaveTypeId === t)), pending: requests.filter((r) => r.leaveTypeId === t && r.status === 'PENDING').length }))
            .sort((a, b) => b.days - a.days),
        },
        {
          key: 'department',
          title: 'By department',
          columns: [
            { key: 'name', label: 'Department' },
            { key: 'people', label: 'People', format: 'number' },
            { key: 'days', label: 'Days taken', format: 'number' },
            { key: 'perEmployee', label: 'Days per person', format: 'number' },
          ],
          rows: departments
            .map((d) => {
              const members = employed.filter((e) => e.departmentId === d);
              const days = sum(approved.filter((r) => byId.get(r.employeeId)?.departmentId === d));
              return { name: names.department(d), people: members.length, days, perEmployee: members.length ? Math.round((days / members.length) * 10) / 10 : null };
            })
            .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name)),
        },
        {
          key: 'people',
          title: 'Most days taken',
          columns: [
            { key: 'name', label: 'Employee' },
            { key: 'code', label: 'Code' },
            { key: 'department', label: 'Department' },
            { key: 'days', label: 'Days', format: 'number' },
          ],
          rows: [...perEmployee.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([id, days]) => {
              const e = byId.get(id)!;
              return { name: fullName(e), code: e.employeeCode, department: names.department(e.departmentId), days: Math.round(days * 10) / 10 };
            }),
        },
      ] satisfies ReportTable[],
    };
  }

  async payrollCost(auth: AuthContext, query: ReportQueryDto) {
    const today = await organizationToday(auth.organizationId!);
    const toMonth = query.toMonth ?? today.slice(0, 7);
    const fromMonth = query.fromMonth ?? addMonths(`${toMonth}-01`, -11).slice(0, 7);
    if (fromMonth > toMonth) throw AppError.validation([{ field: 'fromMonth', message: 'The range must end after it starts' }]);
    const months = monthsBetween(fromMonth, toMonth);
    if (months.length > 24) throw AppError.validation([{ field: 'fromMonth', message: 'Up to 24 months at a time' }]);
    const runs = await PayrollRun.findAll({
      where: { status: ['APPROVED', 'PAID'], [Op.or]: months.map((m) => ({ year: m.year, month: m.month })) },
      order: [['year', 'ASC'], ['month', 'ASC']],
    });
    const trend = runs.map((r) => {
      const gross = Number(r.totalGross);
      const employer = Number(r.totalEmployerContributions);
      return { month: monthLabel(r.year, r.month), employees: r.employeeCount, gross, deductions: Number(r.totalDeductions), net: Number(r.totalNet), employer, cost: money(gross + employer) };
    });
    const latest = runs[runs.length - 1];
    const slips = latest ? await Payslip.findAll({ where: { runId: latest.id, excluded: false }, attributes: ['employee', 'gross', 'netPay', 'employerContributions'] }) : [];
    const byDept = new Map<string, { employees: number; gross: number; employer: number; net: number }>();
    for (const s of slips) {
      const dept = (s.employee as { department?: string | null }).department ?? 'No department';
      const row = byDept.get(dept) ?? { employees: 0, gross: 0, employer: 0, net: 0 };
      row.employees++;
      row.gross += Number(s.gross);
      row.net += Number(s.netPay);
      row.employer += s.employerContributions.reduce((x, l) => x + l.amount, 0);
      byDept.set(dept, row);
    }
    const total = (k: 'gross' | 'net' | 'employer' | 'cost') => money(trend.reduce((s, t) => s + t[k], 0));
    return {
      fromMonth,
      toMonth,
      summary: {
        runs: runs.length,
        totalGross: total('gross'),
        totalNet: total('net'),
        employerContributions: total('employer'),
        costToCompany: total('cost'),
        averageMonthlyCost: runs.length ? money(total('cost') / runs.length) : null,
        latestMonth: latest ? monthLabel(latest.year, latest.month) : null,
      },
      trend,
      tables: [
        {
          key: 'month',
          title: 'By month (approved and paid runs)',
          columns: [
            { key: 'month', label: 'Month' },
            { key: 'employees', label: 'Employees', format: 'number' },
            { key: 'gross', label: 'Gross', format: 'money' },
            { key: 'deductions', label: 'Deductions', format: 'money' },
            { key: 'net', label: 'Net pay', format: 'money' },
            { key: 'employer', label: 'Employer contributions', format: 'money' },
            { key: 'cost', label: 'Cost to company', format: 'money' },
          ],
          rows: trend,
        },
        {
          key: 'department',
          title: latest ? `By department · ${monthLabel(latest.year, latest.month)}` : 'By department',
          columns: [
            { key: 'name', label: 'Department' },
            { key: 'employees', label: 'Employees', format: 'number' },
            { key: 'gross', label: 'Gross', format: 'money' },
            { key: 'employer', label: 'Employer contributions', format: 'money' },
            { key: 'cost', label: 'Cost to company', format: 'money' },
            { key: 'share', label: 'Share of cost', format: 'percent' },
          ],
          rows: (() => {
            const all = [...byDept.values()].reduce((s, r) => s + r.gross + r.employer, 0);
            return [...byDept.entries()]
              .map(([name, r]) => ({ name, employees: r.employees, gross: money(r.gross), employer: money(r.employer), cost: money(r.gross + r.employer), share: pct(r.gross + r.employer, all) }))
              .sort((a, b) => b.cost - a.cost);
          })(),
        },
      ] satisfies ReportTable[],
    };
  }

  async recruitment(auth: AuthContext, query: ReportQueryDto) {
    const today = await organizationToday(auth.organizationId!);
    const { from, to } = this.range(query, today, addMonths(today, -6));
    const range = { [Op.between]: [new Date(`${from}T00:00:00Z`), new Date(`${addDays(to, 1)}T00:00:00Z`)] };
    const applications = await JobApplication.findAll({ where: { createdAt: range }, attributes: ['id', 'jobId', 'candidateId', 'stage', 'source', 'createdAt'], include: [{ model: JobOpening, attributes: ['id', 'title'] }] });
    const hires = applications.length ? await ApplicationEvent.findAll({ where: { applicationId: applications.map((a) => a.id), toStage: 'HIRED' }, attributes: ['applicationId', 'createdAt'] }) : [];
    const hiredAt = new Map(hires.map((h) => [h.applicationId, h.createdAt]));
    const offers = await Offer.findAll({ where: { releasedAt: range }, attributes: ['status'] });
    const accepted = offers.filter((o) => o.status === 'ACCEPTED').length;
    const declined = offers.filter((o) => o.status === 'DECLINED').length;
    const hired = applications.filter((a) => a.stage === 'HIRED');
    const daysToHire = hired.flatMap((a) => {
      const at = hiredAt.get(a.id);
      return at ? [Math.max(0, Math.round((at.getTime() - a.createdAt.getTime()) / 86_400_000))] : [];
    });
    const jobs = new Map<string, { title: string; applications: number; hired: number }>();
    for (const a of applications) {
      const j = jobs.get(a.jobId) ?? { title: a.job?.title ?? 'Unknown job', applications: 0, hired: 0 };
      j.applications++;
      if (a.stage === 'HIRED') j.hired++;
      jobs.set(a.jobId, j);
    }
    const sources = [...new Set(applications.map((a) => a.source))];
    return {
      from,
      to,
      summary: {
        applications: applications.length,
        hired: hired.length,
        conversion: pct(hired.length, applications.length),
        offersReleased: offers.length,
        offersAccepted: accepted,
        offersDeclined: declined,
        acceptanceRate: pct(accepted, accepted + declined),
        medianDaysToHire: median(daysToHire),
        candidates: new Set(applications.map((a) => a.candidateId)).size,
      },
      tables: [
        shareTable('stage', 'Applications by current stage', 'Stage', countBy(applications, (a) => STAGE_LABELS[a.stage] ?? a.stage)),
        {
          key: 'source',
          title: 'By source',
          columns: [
            { key: 'name', label: 'Source' },
            { key: 'applications', label: 'Applications', format: 'number' },
            { key: 'hired', label: 'Hired', format: 'number' },
            { key: 'conversion', label: 'Conversion', format: 'percent' },
          ],
          rows: sources
            .map((s) => {
              const n = applications.filter((a) => a.source === s).length;
              const h = hired.filter((a) => a.source === s).length;
              return { name: SOURCE_LABELS[s] ?? s, applications: n, hired: h, conversion: pct(h, n) };
            })
            .sort((a, b) => b.applications - a.applications),
        },
        {
          key: 'job',
          title: 'By job',
          columns: [
            { key: 'name', label: 'Job' },
            { key: 'applications', label: 'Applications', format: 'number' },
            { key: 'hired', label: 'Hired', format: 'number' },
          ],
          rows: [...jobs.values()].map((j) => ({ name: j.title, applications: j.applications, hired: j.hired })).sort((a, b) => b.applications - a.applications),
        },
      ] satisfies ReportTable[],
    };
  }

  /** The report's tables as CSV (each table under its title). */
  async csv(auth: AuthContext, key: ReportKey, query: ReportQueryDto): Promise<{ fileName: string; content: string }> {
    const report = await this.run(auth, key, query);
    const lines: string[] = [];
    for (const t of report.tables as ReportTable[]) {
      if (lines.length) lines.push('');
      lines.push(csvCell(t.title));
      lines.push(t.columns.map((c) => csvCell(c.label)).join(','));
      for (const r of t.rows) lines.push(t.columns.map((c) => csvCell(r[c.key])).join(','));
    }
    const period = 'asOf' in report ? report.asOf : 'from' in report ? `${report.from} to ${report.to}` : `${report.fromMonth} to ${report.toMonth}`;
    await this.audit.record({ action: 'reports.exported', entityType: 'Report', entityId: key, summary: `${key} report exported (${period})` });
    return { fileName: `${key} report ${period}.csv`, content: lines.join('\r\n') };
  }

  run(auth: AuthContext, key: ReportKey, query: ReportQueryDto) {
    switch (key) {
      case 'headcount':
        return this.headcount(auth, query);
      case 'attrition':
        return this.attrition(auth, query);
      case 'leave':
        return this.leave(auth, query);
      case 'payroll-cost':
        return this.payrollCost(auth, query);
      case 'recruitment':
        return this.recruitment(auth, query);
    }
  }

  // ---- Internals --------------------------------------------------------------------------------

  /** Employees within the caller's reports.view scope (optionally one department). */
  private async people(auth: AuthContext, departmentId?: string) {
    const scoped = await this.scope.where(auth, 'reports.view', 'id');
    if (!scoped) throw AppError.forbidden();
    const conditions: WhereOptions[] = [scoped];
    if (departmentId) conditions.push({ departmentId });
    return Employee.findAll({ where: { [Op.and]: conditions }, attributes: PEOPLE });
  }

  private range(query: ReportQueryDto, today: string, defaultFrom: string) {
    const to = query.to ?? today;
    const from = query.from ?? defaultFrom;
    if (from > to) throw AppError.validation([{ field: 'from', message: 'The period must end after it starts' }]);
    if (daysBetween(from, to) > MAX_REPORT_DAYS) throw AppError.validation([{ field: 'from', message: 'Up to two years at a time' }]);
    return { from, to };
  }

  private async names() {
    const [departments, locations, grades] = await Promise.all([Department.findAll({ attributes: ['id', 'name'] }), Location.findAll({ attributes: ['id', 'name'] }), Grade.findAll({ attributes: ['id', 'name'] })]);
    const map = (rows: { id: string; name: string }[], none: string) => {
      const m = new Map(rows.map((r) => [r.id, r.name]));
      return (id: string | null) => (id ? (m.get(id) ?? none) : none);
    };
    return { department: map(departments, 'No department'), location: map(locations, 'No location'), grade: map(grades, 'No grade') };
  }

  private typeKey(label: string) {
    return (Object.entries(TYPE_LABELS).find(([, v]) => v === label)?.[0] ?? 'FULL_TIME') as (typeof EMPLOYMENT_TYPES)[number];
  }
}
