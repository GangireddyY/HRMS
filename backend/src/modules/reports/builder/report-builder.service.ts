import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import { BUILDER_MAX_ROWS, BUILDER_PREVIEW_ROWS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, LEAVE_REQUEST_STATUSES, REIMBURSEMENT_CATEGORIES, REIMBURSEMENT_STATUSES, WORK_MODES, type BuilderColumn, type BuilderDataset, type BuilderQuery } from '../../../contracts';
import type { AuthContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { fullName } from '../../../common/utils/names';
import { minutesToTime, zonedParts } from '../../../common/utils/zoned-time';
import { AttendanceRecord, CostCenter, CustomFieldDefinition, Department, Designation, Employee, Grade, LeaveRequest, LeaveType, Location, Organization, PayrollRun, Payslip, ReimbursementClaim, SavedReport, User } from '../../../database/models';
import { AuditService } from '../../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../../employees/employee-scope.service';
import { reportCsv, reportXlsx } from '../report-export';
import { runQuery, type Row } from './builder-engine';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MS = 86_400_000;
const yearsBetween = (from: string, to: string) => Math.round(((Date.parse(to) - Date.parse(from)) / (365.25 * DAY_MS)) * 10) / 10;

interface Dataset {
  key: BuilderDataset;
  label: string;
  description: string;
  /** Dated datasets need a period, at most this many days long. */
  dated?: { label: string; maxDays: number };
  allowed(auth: AuthContext): boolean;
  columns(auth: AuthContext): Promise<BuilderColumn[]>;
  load(auth: AuthContext, q: BuilderQuery): Promise<Row[]>;
}

const col = (group: string) => (key: string, label: string, type: BuilderColumn['type'] = 'text', values?: readonly string[]): BuilderColumn => ({ key, label, type, group, ...(values ? { values: [...values] } : {}) });
const EMP = col('Employee');
const EMPLOYEE_COLUMNS = [
  EMP('employeeCode', 'Employee code'),
  EMP('employee', 'Employee'),
  EMP('department', 'Department'),
];

/**
 * The report builder: pick a dataset, columns, filters, sorting and an optional summary (count and totals per value),
 * preview it and export it (CSV or Excel), and save it to run again. Each dataset is limited to what the person may
 * see with that module's permission and scope; sensitive fields are never offered.
 */
@Injectable()
export class ReportBuilderService {
  private readonly datasets: Dataset[];

  constructor(
    private readonly scope: EmployeeScopeService,
    private readonly audit: AuditService,
  ) {
    this.datasets = [this.employees(), this.leave(), this.attendance(), this.claims(), this.payslips()];
  }

  async catalog(auth: AuthContext) {
    const out = [];
    for (const d of this.datasets.filter((x) => x.allowed(auth))) out.push({ key: d.key, label: d.label, description: d.description, dated: d.dated ?? null, columns: await d.columns(auth) });
    return out;
  }

  async run(auth: AuthContext, q: BuilderQuery) {
    const { result, capped } = await this.execute(auth, q);
    return { columns: result.columns, rows: result.rows.slice(0, BUILDER_PREVIEW_ROWS), total: result.rows.length, truncated: result.rows.length > BUILDER_PREVIEW_ROWS, capped };
  }

  async export(auth: AuthContext, q: BuilderQuery, format: 'csv' | 'xlsx', title = 'Report') {
    const d = this.dataset(auth, q.dataset);
    const { result } = await this.execute(auth, q);
    const formatOf = (t: BuilderColumn['type']) => (t === 'money' ? 'money' : t === 'number' ? 'number' : t === 'date' ? 'date' : undefined);
    const table = {
      key: q.dataset,
      title,
      columns: result.columns.map((c) => ({ key: c.key, label: c.label, ...(formatOf(c.type) && formatOf(c.type) !== 'date' ? { format: formatOf(c.type) as 'money' | 'number' } : {}) })),
      rows: result.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v]))) as Record<string, string | number | null>[],
    };
    await this.audit.record({ action: 'reports.builder_exported', entityType: 'Report', entityId: null, summary: `"${title}" exported from ${d.label.toLowerCase()} (${result.rows.length} rows, ${format.toUpperCase()})`, metadata: { dataset: q.dataset, columns: q.columns, rows: result.rows.length } });
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['name'] });
    const safe = title.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'report';
    if (format === 'csv') return { fileName: `${safe}.csv`, contentType: 'text/csv; charset=utf-8', content: reportCsv([table]) };
    const period = q.from && q.to ? `${q.from} – ${q.to}` : 'All records';
    const content = await reportXlsx({ title, organization: org?.name ?? '', period, generated: new Date().toISOString().slice(0, 10), summary: [{ label: 'Rows', value: result.rows.length, format: 'number' }], tables: [table] });
    return { fileName: `${safe}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content };
  }

  // ---- Saved reports ---------------------------------------------------------------------------

  async saved(auth: AuthContext) {
    const allowed = new Set(this.datasets.filter((d) => d.allowed(auth)).map((d) => d.key));
    const rows = await SavedReport.findAll({ where: { [Op.or]: [{ ownerId: auth.userId }, { shared: true }] }, order: [['name', 'ASC']] });
    const owners = new Map((await User.findAll({ where: { id: [...new Set(rows.map((r) => r.ownerId))] }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
    return rows.filter((r) => allowed.has(r.dataset)).map((r) => ({ id: r.id, name: r.name, description: r.description, dataset: r.dataset, definition: r.definition, shared: r.shared, owner: owners.get(r.ownerId) ?? null, mine: r.ownerId === auth.userId, updatedAt: r.updatedAt }));
  }

  async save(auth: AuthContext, body: { name: string; description?: string | null; shared?: boolean; query: BuilderQuery }, id?: string) {
    await this.execute(auth, { ...body.query, columns: body.query.columns }, true);
    const { dataset, ...definition } = body.query;
    if (id) {
      const r = await SavedReport.findByPk(id);
      if (!r || r.ownerId !== auth.userId) throw AppError.notFound('Saved report');
      await r.update({ name: body.name, description: body.description ?? null, shared: body.shared ?? r.shared, dataset, definition });
    } else {
      await SavedReport.create({ organizationId: auth.organizationId!, ownerId: auth.userId, name: body.name, description: body.description ?? null, shared: body.shared ?? false, dataset, definition });
    }
    return this.saved(auth);
  }

  async remove(auth: AuthContext, id: string) {
    const r = await SavedReport.findByPk(id);
    if (!r || r.ownerId !== auth.userId) throw AppError.notFound('Saved report');
    await r.destroy();
    return { deleted: true };
  }

  // ---- internals -------------------------------------------------------------------------------

  private dataset(auth: AuthContext, key: BuilderDataset): Dataset {
    const d = this.datasets.find((x) => x.key === key);
    if (!d || !d.allowed(auth)) throw AppError.forbidden("You don't have access to this data");
    return d;
  }

  private async execute(auth: AuthContext, q: BuilderQuery, validateOnly = false) {
    const d = this.dataset(auth, q.dataset);
    if (d.dated) {
      if (!q.from || !q.to) throw AppError.validation([{ field: 'from', message: `Choose the period (${d.dated.label.toLowerCase()})` }]);
      if (q.to < q.from) throw AppError.validation([{ field: 'to', message: 'The period must end after it starts' }]);
      if ((Date.parse(q.to) - Date.parse(q.from)) / DAY_MS > d.dated.maxDays) throw AppError.validation([{ field: 'to', message: `Choose a period of up to ${d.dated.maxDays} days` }]);
    }
    const columns = await d.columns(auth);
    if (validateOnly) {
      runQuery(columns, [], q);
      return { result: { columns: [], rows: [] }, capped: false };
    }
    const rows = await d.load(auth, q);
    const capped = rows.length > BUILDER_MAX_ROWS;
    return { result: runQuery(columns, capped ? rows.slice(0, BUILDER_MAX_ROWS) : rows, q), capped };
  }

  private employeeRef = (e: Employee | null | undefined) => ({ employeeCode: e?.employeeCode ?? null, employee: e ? fullName(e) : null, department: e?.department?.name ?? null });

  private employees(): Dataset {
    return {
      key: 'employees',
      label: 'Employees',
      description: 'Everyone you can see, with their job, dates and custom fields',
      allowed: (auth) => auth.permissions.has('employee.view'),
      columns: async (auth) => {
        const defs = await CustomFieldDefinition.findAll({ where: { entity: 'EMPLOYEE', archivedAt: null, ...(auth.permissions.get('employee.sensitive.view') === 'ORGANIZATION' ? {} : { sensitive: false }) }, order: [['sortOrder', 'ASC']] });
        const CF = col('Custom fields');
        return [
          ...EMPLOYEE_COLUMNS,
          EMP('firstName', 'First name'),
          EMP('lastName', 'Last name'),
          EMP('workEmail', 'Work email'),
          EMP('status', 'Status', 'text', EMPLOYEE_STATUSES),
          EMP('employmentType', 'Employment type', 'text', EMPLOYMENT_TYPES),
          EMP('designation', 'Designation'),
          EMP('location', 'Location'),
          EMP('grade', 'Grade'),
          EMP('costCenter', 'Cost center'),
          EMP('manager', 'Manager'),
          EMP('gender', 'Gender'),
          EMP('dateOfJoining', 'Date of joining', 'date'),
          EMP('tenureYears', 'Tenure (years)', 'number'),
          EMP('dateOfBirth', 'Date of birth', 'date'),
          EMP('age', 'Age', 'number'),
          EMP('probationEndDate', 'Probation ends', 'date'),
          EMP('confirmedOn', 'Confirmed on', 'date'),
          EMP('exitDate', 'Exit date', 'date'),
          EMP('noticePeriodDays', 'Notice period (days)', 'number'),
          ...defs.map((d) => CF(`cf.${d.key}`, d.label, d.type === 'NUMBER' ? 'number' : d.type === 'DATE' ? 'date' : d.type === 'BOOLEAN' ? 'boolean' : 'text', d.type === 'SELECT' || d.type === 'MULTI_SELECT' ? d.options : undefined)),
        ];
      },
      load: async (auth) => {
        const where = await this.scope.where(auth, 'employee.view');
        if (!where) return [];
        const keys = (await CustomFieldDefinition.findAll({ where: { entity: 'EMPLOYEE', archivedAt: null }, attributes: ['key', 'sensitive'] })).filter((d) => !d.sensitive || auth.permissions.get('employee.sensitive.view') === 'ORGANIZATION').map((d) => d.key);
        const today = new Date().toISOString().slice(0, 10);
        const rows = await Employee.findAll({
          where,
          attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'workEmail', 'status', 'employmentType', 'gender', 'dateOfJoining', 'dateOfBirth', 'probationEndDate', 'confirmedOn', 'exitDate', 'noticePeriodDays', 'customFields'],
          include: [
            { model: Department, attributes: ['name'] },
            { model: Designation, attributes: ['name'] },
            { model: Location, attributes: ['name'] },
            { model: Grade, attributes: ['name'] },
            { model: CostCenter, attributes: ['name'] },
            { model: Employee, as: 'manager', attributes: ['firstName', 'lastName'] },
          ],
          order: [['employeeCode', 'ASC']],
          limit: BUILDER_MAX_ROWS + 1,
        });
        return rows.map((e) => ({
          ...this.employeeRef(e),
          firstName: e.firstName,
          lastName: e.lastName,
          workEmail: e.workEmail,
          status: e.status,
          employmentType: e.employmentType,
          designation: e.designation?.name ?? null,
          location: e.location?.name ?? null,
          grade: e.grade?.name ?? null,
          costCenter: e.costCenter?.name ?? null,
          manager: e.manager ? fullName(e.manager) : null,
          gender: e.gender,
          dateOfJoining: e.dateOfJoining,
          tenureYears: yearsBetween(e.dateOfJoining, e.exitDate && e.exitDate < today ? e.exitDate : today),
          dateOfBirth: e.dateOfBirth,
          age: e.dateOfBirth ? Math.floor(yearsBetween(e.dateOfBirth, today)) : null,
          probationEndDate: e.probationEndDate,
          confirmedOn: e.confirmedOn,
          exitDate: e.exitDate,
          noticePeriodDays: e.noticePeriodDays,
          ...Object.fromEntries(keys.map((k) => {
            const v = e.customFields?.[k];
            return [`cf.${k}`, Array.isArray(v) ? v.join('; ') : (v ?? null)];
          })),
        }));
      },
    };
  }

  private leave(): Dataset {
    const L = col('Leave');
    return {
      key: 'leave_requests',
      label: 'Leave requests',
      description: 'Leave overlapping the period, with type, days and status',
      dated: { label: 'Leave dates', maxDays: 732 },
      allowed: (auth) => auth.permissions.has('leave.view'),
      columns: async () => {
        const types = (await LeaveType.findAll({ attributes: ['name'], order: [['name', 'ASC']] })).map((t) => t.name);
        return [...EMPLOYEE_COLUMNS, L('leaveType', 'Leave type', 'text', types), L('startDate', 'From', 'date'), L('endDate', 'To', 'date'), L('days', 'Days', 'number'), L('status', 'Status', 'text', LEAVE_REQUEST_STATUSES), L('reason', 'Reason'), L('appliedOn', 'Applied on', 'date')];
      },
      load: async (auth, q) => {
        const scoped = await this.scope.where(auth, 'leave.view', 'employeeId');
        if (!scoped) return [];
        const rows = await LeaveRequest.findAll({
          where: { [Op.and]: [scoped, { startDate: { [Op.lte]: q.to }, endDate: { [Op.gte]: q.from } }] } as WhereOptions,
          include: [{ model: Employee, attributes: ['employeeCode', 'firstName', 'lastName'], include: [{ model: Department, attributes: ['name'] }] }, { model: LeaveType, attributes: ['name'] }],
          order: [['startDate', 'ASC']],
          limit: BUILDER_MAX_ROWS + 1,
        });
        return rows.map((r) => ({ ...this.employeeRef(r.employee), leaveType: r.leaveType?.name ?? null, startDate: r.startDate, endDate: r.endDate, days: Number(r.days), status: r.status, reason: r.reason, appliedOn: r.createdAt.toISOString().slice(0, 10) }));
      },
    };
  }

  private attendance(): Dataset {
    const A = col('Attendance');
    return {
      key: 'attendance',
      label: 'Attendance',
      description: 'Daily attendance records in the period',
      dated: { label: 'Work dates', maxDays: 93 },
      allowed: (auth) => auth.permissions.has('attendance.view'),
      columns: async () => [
        ...EMPLOYEE_COLUMNS,
        A('date', 'Date', 'date'),
        A('status', 'Status'),
        A('workMode', 'Work mode', 'text', WORK_MODES),
        A('checkIn', 'In'),
        A('checkOut', 'Out'),
        A('workedHours', 'Hours worked', 'number'),
        A('lateMinutes', 'Late (minutes)', 'number'),
        A('overtimeMinutes', 'Overtime (minutes)', 'number'),
        A('source', 'Source'),
      ],
      load: async (auth, q) => {
        const scoped = await this.scope.where(auth, 'attendance.view', 'employeeId');
        if (!scoped) return [];
        const tz = (await Organization.findByPk(auth.organizationId!, { attributes: ['timezone'] }))?.timezone ?? 'UTC';
        const time = (d: Date | null) => (d ? minutesToTime(zonedParts(d, tz).minutes) : null);
        const rows = await AttendanceRecord.findAll({
          where: { [Op.and]: [scoped, { workDate: { [Op.between]: [q.from!, q.to!] } }] } as WhereOptions,
          include: [{ model: Employee, attributes: ['employeeCode', 'firstName', 'lastName'], include: [{ model: Department, attributes: ['name'] }] }],
          order: [['workDate', 'ASC']],
          limit: BUILDER_MAX_ROWS + 1,
        });
        return rows.map((r) => ({
          ...this.employeeRef(r.employee),
          date: r.workDate,
          status: r.status,
          workMode: r.workMode,
          checkIn: time(r.checkInAt),
          checkOut: time(r.checkOutAt),
          workedHours: r.workedMinutes === null ? null : Math.round((r.workedMinutes / 60) * 100) / 100,
          lateMinutes: r.lateMinutes,
          overtimeMinutes: r.overtimeMinutes,
          source: r.source,
        }));
      },
    };
  }

  private claims(): Dataset {
    const C = col('Expense claim');
    return {
      key: 'claims',
      label: 'Expense claims',
      description: 'Reimbursement claims by expense date',
      dated: { label: 'Expense dates', maxDays: 732 },
      allowed: (auth) => auth.permissions.has('payroll.view') || auth.permissions.has('payroll.reimbursement.approve'),
      columns: async () => [...EMPLOYEE_COLUMNS, C('category', 'Category', 'text', REIMBURSEMENT_CATEGORIES), C('title', 'Expense'), C('expenseDate', 'Expense date', 'date'), C('amount', 'Amount', 'money'), C('status', 'Status', 'text', REIMBURSEMENT_STATUSES), C('submittedOn', 'Submitted on', 'date')],
      load: async (auth, q) => {
        const scoped = auth.permissions.has('payroll.view') ? {} : await this.scope.where(auth, 'payroll.reimbursement.approve', 'employeeId');
        if (!scoped) return [];
        const rows = await ReimbursementClaim.findAll({
          where: { [Op.and]: [scoped, { expenseDate: { [Op.between]: [q.from!, q.to!] } }] } as WhereOptions,
          include: [{ model: Employee, attributes: ['employeeCode', 'firstName', 'lastName'], include: [{ model: Department, attributes: ['name'] }] }],
          order: [['expenseDate', 'ASC']],
          limit: BUILDER_MAX_ROWS + 1,
        });
        return rows.map((r) => ({ ...this.employeeRef(r.employee), category: r.category, title: r.title, expenseDate: r.expenseDate, amount: Number(r.amount), status: r.status, submittedOn: r.createdAt.toISOString().slice(0, 10) }));
      },
    };
  }

  private payslips(): Dataset {
    const P = col('Payslip');
    return {
      key: 'payslips',
      label: 'Payslips',
      description: 'Approved and paid payslips for the months in the period',
      dated: { label: 'Pay months', maxDays: 732 },
      allowed: (auth) => auth.permissions.has('payroll.view') && auth.permissions.has('reports.payroll.view'),
      columns: async () => [
        ...EMPLOYEE_COLUMNS,
        P('designation', 'Designation'),
        P('location', 'Location'),
        P('period', 'Month'),
        P('periodStart', 'Month starting', 'date'),
        P('payableDays', 'Payable days', 'number'),
        P('lopDays', 'Loss-of-pay days', 'number'),
        P('gross', 'Gross pay', 'money'),
        P('deductions', 'Deductions', 'money'),
        P('netPay', 'Net pay', 'money'),
      ],
      load: async (_auth, q) => {
        const [fy, fm] = q.from!.split('-').map(Number) as [number, number];
        const [ty, tm] = q.to!.split('-').map(Number) as [number, number];
        const runs = (await PayrollRun.findAll({ where: { status: ['APPROVED', 'PAID'] }, attributes: ['id', 'year', 'month'] })).filter((r) => r.year * 12 + r.month >= fy * 12 + fm && r.year * 12 + r.month <= ty * 12 + tm);
        if (!runs.length) return [];
        const byRun = new Map(runs.map((r) => [r.id, r]));
        const slips = await Payslip.findAll({ where: { runId: runs.map((r) => r.id), excluded: false }, attributes: ['runId', 'employee', 'payableDays', 'lopDays', 'gross', 'totalDeductions', 'netPay'], limit: BUILDER_MAX_ROWS + 1 });
        return slips.map((s) => {
          const run = byRun.get(s.runId)!;
          const e = s.employee as { name?: string; employeeCode?: string; department?: string | null; designation?: string | null; location?: string | null };
          return {
            employeeCode: e.employeeCode ?? null,
            employee: e.name ?? null,
            department: e.department ?? null,
            designation: e.designation ?? null,
            location: e.location ?? null,
            period: `${MONTHS[run.month - 1]} ${run.year}`,
            periodStart: `${run.year}-${String(run.month).padStart(2, '0')}-01`,
            payableDays: Number(s.payableDays),
            lopDays: Number(s.lopDays),
            gross: Number(s.gross),
            deductions: Number(s.totalDeductions),
            netPay: Number(s.netPay),
          };
        });
      },
    };
  }
}
