import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { containsPattern } from '../../common/utils/like';
import { fullName } from '../../common/utils/names';
import { addDays } from '../../common/utils/zoned-time';
import { Department, Designation, Employee, Holiday, LeaveRequest, LeaveType, Location, PayrollRun, Payslip, Policy, PolicyVersion } from '../../database/models';
import { ApprovalsSummaryService } from '../dashboard/approvals-summary.service';
import { organizationToday } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { LeaveBalanceService } from '../leave/leave-balance.service';

/** JSON schema of a tool's arguments (OpenAI function calling). */
type Schema = { type: 'object'; properties: Record<string, { type: string; description: string; minimum?: number; maximum?: number }>; required?: string[] };

export interface AssistantTool {
  name: string;
  description: string;
  parameters: Schema;
  /** The caller has the module and permission this tool reads with. */
  allowed: (auth: AuthContext) => boolean;
  run: (auth: AuthContext, args: Record<string, unknown>) => Promise<unknown>;
}

const NO_ARGS: Schema = { type: 'object', properties: {} };
const has = (auth: AuthContext, feature: string, ...permissions: string[]) => auth.features.has(feature as never) && permissions.every((p) => auth.permissions.has(p));
const words = (q: string) => [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))];

/**
 * What the assistant may look up, each with the caller's own access (the same scopes as the screens). Tools return
 * small, plain records — never sensitive fields (bank, PAN, salary structure) — and the model answers only from them.
 */
@Injectable()
export class AssistantToolsService {
  readonly tools: AssistantTool[];

  constructor(
    private readonly scope: EmployeeScopeService,
    private readonly balances: LeaveBalanceService,
    private readonly approvals: ApprovalsSummaryService,
  ) {
    this.tools = [
      {
        name: 'my_profile',
        description: "The user's own job details: designation, department, location, manager, joining date, probation end, employment type.",
        parameters: NO_ARGS,
        allowed: (a) => !!a.organizationId,
        run: (a) => this.profile(a),
      },
      {
        name: 'my_leave',
        description: "The user's leave balances by type this leave year, and their pending or upcoming leave requests.",
        parameters: NO_ARGS,
        allowed: (a) => has(a, 'leave', 'leave.view'),
        run: (a) => this.leave(a),
      },
      {
        name: 'upcoming_holidays',
        description: 'Holidays in the coming days that apply to the user (optional holidays are marked).',
        parameters: { type: 'object', properties: { days: { type: 'integer', description: 'How many days ahead (default 90)', minimum: 1, maximum: 366 } } },
        allowed: (a) => !!a.organizationId,
        run: (a, args) => this.holidays(a, Number(args.days) || 90),
      },
      {
        name: 'search_policies',
        description: "Search the organization's published HR policies that apply to the user (leave, travel, conduct, IT, benefits…). Returns matching policies with excerpts; answer policy questions only from these.",
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, e.g. "carry forward leave" or "travel per diem"' } }, required: ['query'] },
        allowed: (a) => has(a, 'compliance', 'compliance.view'),
        run: (a, args) => this.policies(a, String(args.query ?? '')),
      },
      {
        name: 'my_payslips',
        description: "The user's recent payslips: month, gross pay, deductions, net pay and currency.",
        parameters: NO_ARGS,
        allowed: (a) => has(a, 'payroll', 'payroll.payslip.view'),
        run: (a) => this.payslips(a),
      },
      {
        name: 'pending_approvals',
        description: 'How many requests are waiting for the user to approve, by kind (leave, expenses, timesheets…).',
        parameters: NO_ARGS,
        allowed: (a) => !!a.organizationId,
        run: async (a) => (await this.approvals.summary(a)).filter((s) => s.count > 0),
      },
      {
        name: 'team_on_leave',
        description: 'Approved leave of people the user can see, overlapping the coming days.',
        parameters: { type: 'object', properties: { days: { type: 'integer', description: 'How many days ahead including today (default 7)', minimum: 1, maximum: 60 } } },
        allowed: (a) => has(a, 'leave', 'leave.view'),
        run: (a, args) => this.teamLeave(a, Number(args.days) || 7),
      },
      {
        name: 'find_employee',
        description: 'Find colleagues the user can see by name or employee code: designation, department, work email, manager.',
        parameters: { type: 'object', properties: { name: { type: 'string', description: 'Name or employee code' } }, required: ['name'] },
        allowed: (a) => has(a, 'employee', 'employee.view'),
        run: (a, args) => this.findEmployee(a, String(args.name ?? '')),
      },
    ];
  }

  forUser(auth: AuthContext): AssistantTool[] {
    return this.tools.filter((t) => t.allowed(auth));
  }

  private async profile(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { employee: false, note: 'The user has no employee record in this organization.' };
    const e = (await Employee.findByPk(self.id, {
      attributes: ['employeeCode', 'firstName', 'lastName', 'dateOfJoining', 'probationEndDate', 'confirmedOn', 'employmentType', 'status', 'workEmail'],
      include: [
        { model: Department, attributes: ['name'] },
        { model: Designation, attributes: ['name'] },
        { model: Location, attributes: ['name'] },
        { model: Employee, as: 'manager', attributes: ['firstName', 'lastName'] },
      ],
    }))!;
    return {
      name: fullName(e),
      employeeCode: e.employeeCode,
      designation: e.designation?.name ?? null,
      department: e.department?.name ?? null,
      location: e.location?.name ?? null,
      manager: e.manager ? fullName(e.manager) : null,
      dateOfJoining: e.dateOfJoining,
      probationEnds: e.probationEndDate,
      confirmedOn: e.confirmedOn,
      employmentType: e.employmentType,
      status: e.status,
      workEmail: e.workEmail,
    };
  }

  private async leave(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { employee: false };
    const today = await organizationToday(auth.organizationId!);
    const b = await this.balances.balances(auth, undefined, undefined);
    const requests = await LeaveRequest.findAll({
      where: { employeeId: self.id, [Op.or]: [{ status: 'PENDING' }, { status: 'APPROVED', endDate: { [Op.gte]: today } }] },
      include: [{ model: LeaveType, attributes: ['name'] }],
      order: [['startDate', 'ASC']],
      limit: 10,
    });
    return {
      leaveYear: b.range,
      balances: b.balances.map((r) => ({ type: r.leaveType.name, available: r.available, taken: r.taken, pending: r.pending, unlimited: r.leaveType.unlimited })),
      requests: requests.map((r) => ({ type: r.leaveType?.name ?? null, from: r.startDate, to: r.endDate, days: Number(r.days), status: r.status })),
      link: '/me/leave',
    };
  }

  private async holidays(auth: AuthContext, days: number) {
    const self = await this.scope.self(auth);
    const locationId = self ? ((await Employee.findByPk(self.id, { attributes: ['locationId'] }))?.locationId ?? null) : null;
    const today = await organizationToday(auth.organizationId!);
    const rows = await Holiday.findAll({ where: { date: { [Op.between]: [today, addDays(today, Math.min(days, 366))] } }, order: [['date', 'ASC']] });
    return rows.filter((h) => !h.locationIds?.length || (locationId && h.locationIds.includes(locationId))).map((h) => ({ date: h.date, name: h.name, optional: h.isOptional }));
  }

  private async policies(auth: AuthContext, query: string) {
    const terms = words(query);
    if (!terms.length) return { matches: [], note: 'Give a more specific query.' };
    const self = await this.scope.self(auth);
    const me = self ? await Employee.findByPk(self.id, { attributes: ['departmentId', 'locationId', 'employmentType'] }) : null;
    const applies = (list: string[] | null | undefined, value: string | null | undefined) => !list?.length || (!!value && list.includes(value));
    const policies = (await Policy.findAll({ where: { status: 'PUBLISHED' }, attributes: ['id', 'title', 'summary', 'category', 'currentVersionId', 'departmentIds', 'locationIds', 'employmentTypes'] })).filter(
      (p) => applies(p.departmentIds, me?.departmentId) && applies(p.locationIds, me?.locationId) && applies(p.employmentTypes as string[] | null, me?.employmentType),
    );
    const versions = new Map((await PolicyVersion.findAll({ where: { id: policies.map((p) => p.currentVersionId).filter((x): x is string => !!x) }, attributes: ['id', 'version', 'content', 'effectiveFrom'] })).map((v) => [v.id, v]));
    const scored = policies
      .map((p) => {
        const v = p.currentVersionId ? versions.get(p.currentVersionId) : undefined;
        const title = p.title.toLowerCase();
        const summary = (p.summary ?? '').toLowerCase();
        const content = v?.content ?? '';
        const lower = content.toLowerCase();
        const score = terms.reduce((n, t) => n + (title.includes(t) ? 5 : 0) + (summary.includes(t) ? 3 : 0) + Math.min(5, lower.split(t).length - 1), 0);
        const at = Math.max(0, ...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).slice(0, 1));
        return { score, policy: { title: p.title, category: p.category, summary: p.summary, version: v?.version ?? null, effectiveFrom: v?.effectiveFrom ?? null, excerpt: content ? content.slice(Math.max(0, at - 200), at + 900) : null, link: `/me/policies/${p.id}` } };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { matches: scored.map((s) => s.policy) };
  }

  private async payslips(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const rows = await Payslip.findAll({
      where: { employeeId: self.id, excluded: false },
      attributes: ['id', 'gross', 'totalDeductions', 'netPay', 'currency'],
      include: [{ model: PayrollRun, where: { status: ['APPROVED', 'PAID'] }, attributes: ['year', 'month', 'status'] }],
      order: [
        ['run', 'year', 'DESC'],
        ['run', 'month', 'DESC'],
      ],
      limit: 6,
    });
    return rows.map((p) => ({ month: `${p.run!.year}-${String(p.run!.month).padStart(2, '0')}`, gross: Number(p.gross), deductions: Number(p.totalDeductions), netPay: Number(p.netPay), currency: p.currency, paid: p.run!.status === 'PAID', link: `/me/payslips/${p.id}` }));
  }

  private async teamLeave(auth: AuthContext, days: number) {
    const scoped = await this.scope.where(auth, 'leave.view', 'employeeId');
    if (!scoped) return [];
    const today = await organizationToday(auth.organizationId!);
    const to = addDays(today, Math.min(days, 60) - 1);
    const rows = await LeaveRequest.findAll({
      where: { [Op.and]: [scoped, { status: 'APPROVED', startDate: { [Op.lte]: to }, endDate: { [Op.gte]: today } }] } as WhereOptions,
      include: [{ model: Employee, attributes: ['firstName', 'lastName'] }, { model: LeaveType, attributes: ['name'] }],
      order: [['startDate', 'ASC']],
      limit: 50,
    });
    return rows.map((r) => ({ name: r.employee ? fullName(r.employee) : null, type: r.leaveType?.name ?? null, from: r.startDate, to: r.endDate }));
  }

  private async findEmployee(auth: AuthContext, name: string) {
    const q = name.trim();
    if (q.length < 2) return [];
    const scoped = await this.scope.where(auth, 'employee.view');
    if (!scoped) return [];
    const like = containsPattern(q);
    const rows = await Employee.findAll({
      where: { [Op.and]: [scoped, { status: ['ACTIVE', 'ON_NOTICE'] }, { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] }] } as WhereOptions,
      attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'workEmail'],
      include: [
        { model: Department, attributes: ['name'] },
        { model: Designation, attributes: ['name'] },
        { model: Employee, as: 'manager', attributes: ['firstName', 'lastName'] },
      ],
      limit: 5,
    });
    return rows.map((e) => ({ name: fullName(e), employeeCode: e.employeeCode, designation: e.designation?.name ?? null, department: e.department?.name ?? null, workEmail: e.workEmail, manager: e.manager ? fullName(e.manager) : null, link: `/hr/employees/${e.id}` }));
  }
}
