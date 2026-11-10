import { Injectable } from '@nestjs/common';
import { literal, Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { timesheetDueDate, weekStartOf, type TimesheetStatus, type TimesheetWeekStatus } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { RequestContext } from '../../common/context/request-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { addDays, zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceRecord, Department, Employee, PayrollSettings, Timesheet, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, managerAndCover, userIdsOf } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessService } from '../rbac/access.service';
import { AttendanceRulesService, type EmployeeContext } from './attendance-rules.service';
import type { ReviewDto, SaveTimesheetDto, TimesheetBoardQueryDto, TimesheetQueryDto, TimesheetRemindDto, TimesheetWeekQueryDto } from './dto/attendance.dto';
import { cleanEntries, dateLabel, dayTotals, hoursLabel, NO_TIMESHEET_RULES, overlaps, reminderText, weekDates, weekLabel, type ReminderKind, type TimesheetRules } from './timesheet-rules';

const APPROVE = 'attendance.timesheet.approve';
const EMPLOYEE_ATTRIBUTES = [
  'id',
  'organizationId',
  'firstName',
  'lastName',
  'employeeCode',
  'managerId',
  'departmentId',
  'membershipId',
  'dateOfJoining',
  'exitDate',
  'status',
  'shiftId',
  'locationId',
] as const;
/** Timesheets older than this can no longer be edited (payroll has long used them). */
const EDIT_WINDOW_WEEKS = 26;

/** What a day of the week is for the employee, shown above the timesheet grid. */
export type TimesheetDayKind = 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY' | 'LEAVE' | 'NOT_EMPLOYED';

/**
 * Weekly timesheets: employees log what they worked on each day (`attendance.timesheet.submit`) and submit the week;
 * their manager or HR (`attendance.timesheet.approve`, in scope, never the employee) approves it or sends it back.
 * When the organization requires timesheets, payroll treats weeks without an approved one as configured in the
 * payroll settings (flag, loss of pay or hold).
 */
@Injectable()
export class TimesheetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly notifications: NotificationsService,
    private readonly access: AccessService,
  ) {}

  async timesheetRules(organizationId: string): Promise<TimesheetRules> {
    const s = await PayrollSettings.findByPk(organizationId, { attributes: ['organizationId', 'timesheetsRequired', 'timesheetsFrom', 'timesheetDueWeekday', 'timesheetMissedAction'] });
    if (!s) return { ...NO_TIMESHEET_RULES };
    return { required: s.timesheetsRequired, from: s.timesheetsFrom, dueWeekday: s.timesheetDueWeekday, missedAction: s.timesheetMissedAction };
  }

  // ---- My week ---------------------------------------------------------------------------------

  async week(auth: AuthContext, query: TimesheetWeekQueryDto) {
    const self = await this.requireSelf(auth);
    const tz = await this.rules.organizationTimeZone(auth.organizationId!);
    const today = this.rules.today(tz);
    const weekStart = weekStartOf(query.weekStart ?? today);
    const weekEnd = addDays(weekStart, 6);
    const [ctx, sheet, rules, previous] = await Promise.all([
      this.rules.context(auth.organizationId!, self, { from: weekStart, to: weekEnd }),
      Timesheet.findOne({ where: { employeeId: self.id, weekStart } }),
      this.timesheetRules(auth.organizationId!),
      Timesheet.findOne({ where: { employeeId: self.id, weekStart: { [Op.lt]: weekStart } }, order: [['weekStart', 'DESC']], attributes: ['id', 'weekStart', 'entries'] }),
    ]);
    const days = await this.days(self, weekStart, ctx, this.rules.today(ctx.timeZone));
    const currentWeek = weekStartOf(this.rules.today(ctx.timeZone));
    return {
      weekStart,
      weekEnd,
      today: this.rules.today(ctx.timeZone),
      dueDate: timesheetDueDate(weekStart, rules.dueWeekday),
      rules: { required: rules.required && (!rules.from || weekEnd >= rules.from), dueWeekday: rules.dueWeekday, missedAction: rules.missedAction, from: rules.from },
      days,
      timesheet: sheet ? this.present(sheet, await this.names([sheet.reviewedById]), self.id, rules.dueWeekday) : null,
      previous: previous && previous.entries.length ? { weekStart: previous.weekStart, entries: previous.entries } : null,
      canEdit:
        weekStart <= currentWeek && weekEnd >= self.dateOfJoining && weekStart >= addDays(currentWeek, -7 * EDIT_WINDOW_WEEKS) && (!sheet || sheet.status === 'DRAFT' || sheet.status === 'REJECTED'),
    };
  }

  async save(auth: AuthContext, dto: SaveTimesheetDto, submit: boolean) {
    const self = await this.requireSelf(auth);
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    const weekStart = dto.weekStart;
    if (weekStartOf(weekStart) !== weekStart) throw AppError.validation([{ field: 'weekStart', message: 'Use the Monday of the week' }]);
    const weekEnd = addDays(weekStart, 6);
    const ctx = await this.rules.context(auth.organizationId!, self, { from: weekStart, to: weekEnd });
    const today = this.rules.today(ctx.timeZone);
    const currentWeek = weekStartOf(today);
    if (weekStart > currentWeek) throw AppError.validation([{ field: 'weekStart', message: 'You can fill in this week or earlier weeks' }]);
    if (weekEnd < self.dateOfJoining) throw AppError.validation([{ field: 'weekStart', message: 'This week is before your date of joining' }]);
    if (weekStart < addDays(currentWeek, -7 * EDIT_WINDOW_WEEKS)) throw AppError.validation([{ field: 'weekStart', message: `Timesheets older than ${EDIT_WINDOW_WEEKS} weeks can't be changed` }]);

    const entries = cleanEntries(dto.entries);
    const issues: { field: string; message: string }[] = [];
    const dates = weekDates(weekStart);
    const label = (day: number) => dateLabel(dates[day]!);
    entries.forEach((e) => {
      if (!e.project) issues.push({ field: 'entries', message: `${label(e.day)}: say which project you worked on` });
      if (!e.minutes) issues.push({ field: 'entries', message: `${label(e.day)}: ${e.project || 'an activity'} has no time` });
    });
    for (const [a, b] of overlaps(entries)) {
      issues.push({ field: 'entries', message: `${label(entries[a]!.day)}: ${entries[a]!.start}–${entries[a]!.end} overlaps ${entries[b]!.start}–${entries[b]!.end}` });
    }
    dayTotals(entries).forEach((minutes, i) => {
      const date = dates[i]!;
      if (!minutes) return;
      if (minutes > 1440) issues.push({ field: 'entries', message: `More than 24 hours on ${label(i)}` });
      if (date > today) issues.push({ field: 'entries', message: `${label(i)} hasn't happened yet` });
      if (date < self.dateOfJoining || (self.exitDate && date > self.exitDate)) issues.push({ field: 'entries', message: `You weren't employed on ${label(i)}` });
    });
    const total = entries.reduce((sum, e) => sum + e.minutes, 0);
    if (submit && !total) issues.push({ field: 'entries', message: 'Add the time you worked before submitting' });
    if (issues.length) throw AppError.validation(issues);

    try {
      await this.db.transaction(async (transaction) => {
        const existing = await Timesheet.findOne({ where: { employeeId: self.id, weekStart }, transaction, lock: transaction.LOCK.UPDATE });
        if (existing?.status === 'SUBMITTED') throw AppError.conflict('This timesheet is waiting for review. Withdraw it to make changes.');
        if (existing?.status === 'APPROVED') throw AppError.conflict("This timesheet is approved and can't be changed");
        const values = {
          entries,
          totalMinutes: total,
          note: dto.note ?? null,
          status: (submit ? 'SUBMITTED' : 'DRAFT') as TimesheetStatus,
          ...(submit ? { submittedAt: new Date(), submittedById: auth.userId, reviewedById: null, reviewedAt: null, reviewNote: null } : {}),
        };
        const sheet = existing
          ? await existing.update(values, { transaction })
          : await Timesheet.create({ organizationId: auth.organizationId!, employeeId: self.id, weekStart, ...values }, { transaction });
        if (!submit) return;
        await this.audit.record(
          { action: 'attendance.timesheet_submitted', entityType: 'Timesheet', entityId: sheet.id, summary: `Timesheet for the week of ${weekLabel(weekStart)} submitted (${hoursLabel(total)})` },
          transaction,
        );
        for (const managerUser of await managerAndCover(self.managerId, transaction)) {
          if (managerUser === auth.userId) continue;
          await this.notifications.notify(
            managerUser,
            {
              organizationId: auth.organizationId,
              type: 'attendance.timesheet',
              title: `${fullName(self)} submitted a timesheet for the week of ${weekLabel(weekStart)}`,
              body: `${hoursLabel(total)} logged.`,
              link: '/hr/attendance/timesheets',
            },
            transaction,
          );
        }
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('This timesheet was just saved from another window. Reload and try again.');
      throw e;
    }
    return this.week(auth, { weekStart });
  }

  /** Takes a submitted timesheet back to a draft so it can be changed. */
  async withdraw(auth: AuthContext, id: string) {
    const self = await this.requireSelf(auth);
    const weekStart = await this.db.transaction(async (transaction) => {
      const sheet = await Timesheet.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!sheet || sheet.employeeId !== self.id) throw AppError.notFound('Timesheet');
      if (sheet.status !== 'SUBMITTED') throw AppError.conflict('Only a timesheet waiting for review can be withdrawn');
      await sheet.update({ status: 'DRAFT', submittedAt: null }, { transaction });
      await this.audit.record(
        { action: 'attendance.timesheet_withdrawn', entityType: 'Timesheet', entityId: id, summary: `Timesheet for the week of ${weekLabel(sheet.weekStart)} withdrawn` },
        transaction,
      );
      return sheet.weekStart;
    });
    return this.week(auth, { weekStart });
  }

  // ---- Lists and review ------------------------------------------------------------------------

  async list(auth: AuthContext, query: TimesheetQueryDto) {
    const self = await this.scope.self(auth);
    const filters: WhereOptions[] = [];
    if ((query.view ?? 'mine') === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    } else {
      const scoped = await this.scope.where(auth, APPROVE, 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(scoped);
      if (self) filters.push({ employeeId: { [Op.ne]: self.id } });
      // A draft is the employee's own business until it is submitted.
      filters.push({ status: { [Op.ne]: 'DRAFT' } });
    }
    if (query.status) filters.push({ status: query.status });
    if (query.weekStart) filters.push({ weekStart: weekStartOf(query.weekStart) });
    const search = query.search?.trim();
    const { rows, count } = await Timesheet.findAndCountAll({
      where: { [Op.and]: filters },
      include: [
        {
          model: Employee,
          attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'departmentId'],
          include: [{ model: Department, attributes: ['id', 'name'] }],
          ...(search
            ? {
                where: {
                  [Op.or]: [{ firstName: { [Op.iLike]: containsPattern(search) } }, { lastName: { [Op.iLike]: containsPattern(search) } }, { employeeCode: { [Op.iLike]: containsPattern(search) } }],
                },
              }
            : {}),
        },
      ],
      order: [
        [literal(`CASE WHEN "Timesheet"."status" = 'SUBMITTED' THEN 0 ELSE 1 END`), 'ASC'],
        ['weekStart', 'DESC'],
        ['submittedAt', 'ASC'],
      ],
      ...paginationArgs(query),
    });
    const [reviewers, rules] = await Promise.all([this.names(rows.map((r) => r.reviewedById)), this.timesheetRules(auth.organizationId!)]);
    return new PaginatedResult(
      rows.map((r) => this.present(r, reviewers, self?.id ?? null, rules.dueWeekday)),
      paginationMeta(query, count),
    );
  }

  /** One timesheet with what each day was (working, holiday, leave…) and punched hours, for the reviewer. */
  async get(auth: AuthContext, id: string) {
    const sheet = await Timesheet.findByPk(id, { include: [{ model: Employee, attributes: [...EMPLOYEE_ATTRIBUTES], include: [{ model: Department, attributes: ['id', 'name'] }] }] });
    const self = await this.scope.self(auth);
    if (!sheet || !sheet.employee) throw AppError.notFound('Timesheet');
    const own = !!self && sheet.employeeId === self.id;
    if (!own && (sheet.status === 'DRAFT' || !(await this.scope.covers(auth, APPROVE, sheet.employee)))) throw AppError.notFound('Timesheet');
    const ctx = await this.rules.context(auth.organizationId!, sheet.employee, { from: sheet.weekStart, to: addDays(sheet.weekStart, 6) });
    const [days, reviewers, rules] = await Promise.all([
      this.days(sheet.employee, sheet.weekStart, ctx, this.rules.today(ctx.timeZone)),
      this.names([sheet.reviewedById]),
      this.timesheetRules(auth.organizationId!),
    ]);
    return { ...this.present(sheet, reviewers, self?.id ?? null, rules.dueWeekday), days };
  }

  async approve(auth: AuthContext, id: string, dto: ReviewDto) {
    await this.review(auth, id, async (sheet, employee, transaction) => {
      await sheet.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record(
        { action: 'attendance.timesheet_approved', entityType: 'Timesheet', entityId: id, summary: `Timesheet of ${fullName(employee)} for the week of ${weekLabel(sheet.weekStart)} approved` },
        transaction,
      );
      await this.tell(sheet, `Your timesheet for the week of ${weekLabel(sheet.weekStart)} was approved`, dto.note ?? undefined, auth, transaction);
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: ReviewDto) {
    if (!dto.note || dto.note.trim().length < 3) throw AppError.validation([{ field: 'note', message: 'Say what needs to change' }]);
    await this.review(auth, id, async (sheet, employee, transaction) => {
      await sheet.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { transaction });
      await this.audit.record(
        { action: 'attendance.timesheet_rejected', entityType: 'Timesheet', entityId: id, summary: `Timesheet of ${fullName(employee)} for the week of ${weekLabel(sheet.weekStart)} sent back` },
        transaction,
      );
      await this.tell(sheet, `Your timesheet for the week of ${weekLabel(sheet.weekStart)} needs changes`, dto.note ?? undefined, auth, transaction);
    });
    return this.get(auth, id);
  }

  // ---- HR board --------------------------------------------------------------------------------

  /** Everyone in scope who was employed during the week, with their timesheet status (or MISSING). */
  async board(auth: AuthContext, query: TimesheetBoardQueryDto) {
    const tz = await this.rules.organizationTimeZone(auth.organizationId!);
    const today = this.rules.today(tz);
    const weekStart = weekStartOf(query.weekStart ?? addDays(today, -7));
    const weekEnd = addDays(weekStart, 6);
    const [rows, rules] = await Promise.all([this.weekRows(auth, weekStart, query.search), this.timesheetRules(auth.organizationId!)]);
    const summary: Record<TimesheetWeekStatus, number> = { MISSING: 0, DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0 };
    for (const r of rows) summary[r.status]++;
    const filtered = query.status ? rows.filter((r) => r.status === query.status) : rows;
    const { offset, limit } = paginationArgs(query);
    return {
      weekStart,
      weekEnd,
      dueDate: timesheetDueDate(weekStart, rules.dueWeekday),
      overdue: timesheetDueDate(weekStart, rules.dueWeekday) < today,
      rules: { required: rules.required && (!rules.from || weekEnd >= rules.from), dueWeekday: rules.dueWeekday, missedAction: rules.missedAction, from: rules.from },
      summary: { ...summary, total: rows.length },
      items: filtered.slice(offset, offset + limit),
      meta: paginationMeta(query, filtered.length),
    };
  }

  /** Notifies everyone in scope whose timesheet for the week is missing, a draft or sent back. */
  async remind(auth: AuthContext, dto: TimesheetRemindDto) {
    const weekStart = weekStartOf(dto.weekStart);
    const today = this.rules.today(await this.rules.organizationTimeZone(auth.organizationId!));
    if (weekStart > weekStartOf(today)) throw AppError.validation([{ field: 'weekStart', message: "This week hasn't started yet" }]);
    const rows = await this.weekRows(auth, weekStart);
    return this.sendReminders(auth.organizationId!, weekStart, 'MANUAL', rows, auth.userId);
  }

  /**
   * Automatic reminders (run by the reminder job inside the organization's tenant context): on the due day to
   * everyone outstanding, and the day after to those still outstanding plus a summary for their managers.
   */
  async autoRemind(organizationId: string, weekStart: string, kind: 'DUE' | 'OVERDUE') {
    return this.sendReminders(organizationId, weekStart, kind, await this.weekRows(null, weekStart), null);
  }

  private async sendReminders(organizationId: string, weekStart: string, kind: ReminderKind, rows: Awaited<ReturnType<TimesheetsService['weekRows']>>, actorUserId: string | null) {
    const rules = await this.timesheetRules(organizationId);
    const due = timesheetDueDate(weekStart, rules.dueWeekday);
    const week = weekLabel(weekStart);
    const outstanding = rows.filter((r) => r.status === 'MISSING' || r.status === 'DRAFT' || r.status === 'REJECTED');
    const users = await userIdsOf(outstanding.map((r) => r.employee.id));
    const managersBy = kind === 'OVERDUE' && outstanding.length ? await this.managersOf(outstanding.map((r) => r.employee.id)) : new Map<string, string[]>();
    let reminded = 0;
    let managers = 0;
    await this.db.transaction(async (transaction) => {
      for (const r of outstanding) {
        const userId = users.get(r.employee.id);
        if (!userId || userId === actorUserId) continue;
        await this.notifications.notify(
          userId,
          { organizationId, type: 'attendance.timesheet', ...reminderText(kind, r.status, week, due, rules), link: `/me/timesheets?week=${weekStart}` },
          transaction,
        );
        reminded++;
      }
      // Managers hear about their own people who are still outstanding (only those who can review timesheets).
      for (const [managerUserId, names] of managersBy) {
        const n = names.length;
        await this.notifications.notify(
          managerUserId,
          {
            organizationId,
            type: 'attendance.timesheet',
            title: `${n} ${n === 1 ? 'person' : 'people'} in your team haven't submitted a timesheet for the week of ${week}`,
            body: names.slice(0, 5).join(', ') + (n > 5 ? ` and ${n - 5} more` : ''),
            link: `/hr/attendance/timesheets?tab=week&week=${weekStart}`,
          },
          transaction,
        );
        managers++;
      }
      await this.audit.record(
        {
          action: 'attendance.timesheet_reminders_sent',
          entityType: 'Timesheet',
          summary: `${kind === 'MANUAL' ? 'Timesheet reminders' : kind === 'DUE' ? 'Automatic due-day timesheet reminders' : 'Automatic overdue timesheet reminders'} for the week of ${week} sent to ${reminded} people${managers ? ` and ${managers} managers` : ''}`,
          metadata: { weekStart, kind, reminded, managers },
        },
        transaction,
      );
    });
    return { reminded, managers };
  }

  /** Manager user → names of their outstanding direct reports, for managers allowed to review timesheets. */
  private async managersOf(employeeIds: string[]): Promise<Map<string, string[]>> {
    const people = await Employee.findAll({ where: { id: employeeIds, managerId: { [Op.ne]: null } }, attributes: ['id', 'firstName', 'lastName', 'managerId'] });
    const managerUsers = await userIdsOf(people.map((p) => p.managerId));
    const out = new Map<string, string[]>();
    for (const p of people) {
      const userId = managerUsers.get(p.managerId!);
      if (userId) out.set(userId, [...(out.get(userId) ?? []), fullName(p)]);
    }
    const organizationId = RequestContext.organizationId()!;
    for (const userId of [...out.keys()]) {
      const access = await this.access.resolve(userId, organizationId).catch(() => null);
      if (!access?.permissions.has(APPROVE)) out.delete(userId);
    }
    return out;
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  /** Everyone employed during the week: in the caller's review scope, or the whole organization (`auth` null, for the reminder job). */
  private async weekRows(auth: AuthContext | null, weekStart: string, search?: string) {
    const weekEnd = addDays(weekStart, 6);
    const scoped = auth ? await this.scope.where(auth, APPROVE, 'id') : {};
    if (!scoped) throw AppError.forbidden("You don't review timesheets");
    const self = auth ? await this.scope.self(auth) : null;
    const term = search?.trim();
    const employees = await Employee.findAll({
      where: {
        [Op.and]: [
          scoped,
          { dateOfJoining: { [Op.lte]: weekEnd } },
          { [Op.or]: [{ exitDate: null }, { exitDate: { [Op.gte]: weekStart } }] },
          ...(self ? [{ id: { [Op.ne]: self.id } }] : []),
          ...(term
            ? [{ [Op.or]: [{ firstName: { [Op.iLike]: containsPattern(term) } }, { lastName: { [Op.iLike]: containsPattern(term) } }, { employeeCode: { [Op.iLike]: containsPattern(term) } }] }]
            : []),
        ],
      },
      attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'departmentId'],
      include: [{ model: Department, attributes: ['id', 'name'] }],
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
    });
    const sheets = employees.length ? await Timesheet.findAll({ where: { weekStart, employeeId: employees.map((e) => e.id) } }) : [];
    const by = new Map(sheets.map((s) => [s.employeeId, s]));
    return employees.map((e) => {
      const s = by.get(e.id);
      return {
        employee: { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null },
        status: (s?.status ?? 'MISSING') as TimesheetWeekStatus,
        timesheetId: s && s.status !== 'DRAFT' ? s.id : null,
        totalMinutes: s?.totalMinutes ?? 0,
        submittedAt: s?.submittedAt ?? null,
        reviewedAt: s?.reviewedAt ?? null,
      };
    });
  }

  /** Each day of the week: what it is for the employee, the hours expected and the hours punched. */
  private async days(employee: Pick<Employee, 'id' | 'dateOfJoining' | 'exitDate'>, weekStart: string, ctx: EmployeeContext, today: string) {
    const weekEnd = addDays(weekStart, 6);
    const [holidays, leave, records] = await Promise.all([
      this.rules.holidays(weekStart, weekEnd),
      this.rules.approvedLeave([employee.id], weekStart, weekEnd),
      AttendanceRecord.findAll({ where: { employeeId: employee.id, workDate: { [Op.between]: [weekStart, weekEnd] } }, attributes: ['workDate', 'workedMinutes', 'checkInAt', 'checkOutAt'] }),
    ]);
    const leaveBy = leave.get(employee.id);
    const recordBy = new Map(records.map((r) => [r.workDate, r]));
    return weekDates(weekStart).map((date) => {
      const holiday = holidays.on(date, ctx.locationId);
      const dayLeave = leaveBy?.get(date);
      const rest = this.rules.isRestDay(ctx, date);
      const offDay = (holiday && !holiday.isOptional) || rest;
      const shift = this.rules.shiftOn(ctx, date);
      let kind: TimesheetDayKind = 'WORKING';
      let label: string | null = holiday?.isOptional ? `${holiday.name} (optional)` : null;
      if (date < employee.dateOfJoining || (employee.exitDate && date > employee.exitDate)) kind = 'NOT_EMPLOYED';
      else if (dayLeave && dayLeave.session === 'FULL' && (!offDay || dayLeave.countsNonWorkingDays)) [kind, label] = ['LEAVE', dayLeave.name];
      else if (holiday && !holiday.isOptional) [kind, label] = ['HOLIDAY', holiday.name];
      else if (rest) kind = 'WEEKLY_OFF';
      else if (dayLeave) label = `${dayLeave.name} (half day)`;
      const expected = kind !== 'WORKING' ? 0 : dayLeave ? Math.round(shift.fullDayMinutes / 2) : shift.fullDayMinutes;
      const record = recordBy.get(date);
      const clock = (at: Date | null | undefined) => {
        if (!at) return null;
        const m = zonedParts(at, ctx.timeZone).minutes;
        return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      };
      return {
        date,
        kind,
        label,
        expectedMinutes: expected,
        workedMinutes: record?.workedMinutes ?? null,
        checkIn: clock(record?.checkInAt),
        checkOut: clock(record?.checkOutAt),
        future: date > today,
      };
    });
  }

  private async review(auth: AuthContext, id: string, fn: (sheet: Timesheet, employee: Employee, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const sheet = await Timesheet.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!sheet) throw AppError.notFound('Timesheet');
      const employee = (await Employee.findByPk(sheet.employeeId, { attributes: [...EMPLOYEE_ATTRIBUTES], transaction }))!;
      if (sheet.status === 'DRAFT' || !(await this.scope.covers(auth, APPROVE, employee))) throw AppError.notFound('Timesheet');
      if (auth.membershipId && employee.membershipId === auth.membershipId) throw AppError.forbidden("You can't review your own timesheet");
      if (sheet.status !== 'SUBMITTED') throw AppError.conflict(`This timesheet is already ${sheet.status === 'APPROVED' ? 'approved' : 'sent back'}`);
      await fn(sheet, employee, transaction);
    });
  }

  private async tell(sheet: Timesheet, title: string, body: string | undefined, auth: AuthContext, transaction: Transaction) {
    const userId = sheet.submittedById ?? (await userIdsOf([sheet.employeeId], transaction)).get(sheet.employeeId);
    if (!userId || userId === auth.userId) return;
    await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'attendance.timesheet', title, body, link: `/me/timesheets?week=${sheet.weekStart}` }, transaction);
  }

  private async requireSelf(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    return self;
  }

  private present(sheet: Timesheet, reviewers: Map<string, string>, selfId: string | null, dueWeekday: number) {
    const e = sheet.employee;
    return {
      id: sheet.id,
      weekStart: sheet.weekStart,
      weekEnd: addDays(sheet.weekStart, 6),
      dueDate: timesheetDueDate(sheet.weekStart, dueWeekday),
      status: sheet.status,
      entries: sheet.entries,
      totalMinutes: sheet.totalMinutes,
      dayTotals: dayTotals(sheet.entries),
      note: sheet.note,
      submittedAt: sheet.submittedAt,
      reviewedAt: sheet.reviewedAt,
      reviewedBy: sheet.reviewedById ? (reviewers.get(sheet.reviewedById) ?? 'Former user') : null,
      reviewNote: sheet.reviewNote,
      updatedAt: sheet.updatedAt,
      employee: e ? { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null } : null,
      permissions: {
        review: sheet.status === 'SUBMITTED' && sheet.employeeId !== selfId,
        withdraw: sheet.status === 'SUBMITTED' && sheet.employeeId === selfId,
      },
    };
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
