import { Injectable } from '@nestjs/common';
import { literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { fullName } from '../../common/utils/names';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceRecord, Employee, Shift, ShiftSwap, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { managerAndCover, userIdsOf } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendanceRulesService } from './attendance-rules.service';
import type { ReviewDto, ShiftSwapDto, ShiftSwapQueryDto, ShiftSwapResponseDto } from './dto/attendance.dto';
import { RosterService } from './roster.service';

const ATTRS = ['id', 'organizationId', 'employeeCode', 'firstName', 'lastName', 'status', 'shiftId', 'locationId', 'managerId', 'departmentId', 'membershipId'];
const APPROVE = 'attendance.regularize.approve';
/** How far ahead a swap can be asked for. */
const MAX_DAYS_AHEAD = 60;
const OPEN = ['ASKED', 'PENDING'] as const;

/**
 * Shift swaps: an employee asks a colleague to trade shifts on a future day (a shift for a shift, or a shift for a day
 * off); the colleague agrees or declines; then the requester's manager — anyone with attendance approval over them,
 * never one of the two — approves, which rosters each onto the other's shift for that day. If either roster changed
 * since the request, approval is refused so nobody ends up on a shift they didn't agree to.
 */
@Injectable()
export class ShiftSwapsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly roster: RosterService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(auth: AuthContext, dto: ShiftSwapDto) {
    const self = await this.self(auth);
    if (dto.colleagueId === self.id) throw AppError.validation([{ field: 'colleagueId', message: 'Choose a colleague' }]);
    const colleague = await Employee.findByPk(dto.colleagueId, { attributes: ATTRS });
    if (!colleague || !['ACTIVE', 'ON_NOTICE'].includes(colleague.status)) throw AppError.validation([{ field: 'colleagueId', message: 'Choose an active colleague' }]);
    const today = this.rules.today(await this.rules.organizationTimeZone(auth.organizationId!));
    if (dto.workDate <= today) throw AppError.validation([{ field: 'workDate', message: 'Swaps are arranged for days from tomorrow' }]);
    if (dto.workDate > addDays(today, MAX_DAYS_AHEAD)) throw AppError.validation([{ field: 'workDate', message: `Ask at most ${MAX_DAYS_AHEAD} days ahead` }]);
    await this.rules.assertOpen(dto.workDate);
    const [mine, theirs] = await this.shiftsOn([self, colleague], dto.workDate);
    if ((mine ?? null) === (theirs ?? null)) throw AppError.validation([{ field: 'colleagueId', message: `You both ${mine ? 'work the same shift' : 'have the day off'} on ${dto.workDate}` }]);
    const id = await this.db.transaction(async (transaction) => {
      const clash = await ShiftSwap.count({
        where: { workDate: dto.workDate, status: [...OPEN], [Op.or]: [{ requesterId: [self.id, colleague.id] }, { colleagueId: [self.id, colleague.id] }] },
        transaction,
      });
      if (clash) throw AppError.conflict(`There is already a swap in progress for one of you on ${dto.workDate}`);
      const swap = await ShiftSwap.create(
        {
          organizationId: auth.organizationId!,
          requesterId: self.id,
          colleagueId: colleague.id,
          workDate: dto.workDate,
          requesterShiftId: mine,
          colleagueShiftId: theirs,
          reason: dto.reason,
          requestedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record({ action: 'attendance.swap_requested', entityType: 'ShiftSwap', entityId: swap.id, summary: `${self.employeeCode} asked ${colleague.employeeCode} to swap shifts on ${dto.workDate}` }, transaction);
      await this.tellEmployee(colleague.id, swap, `${fullName(self)} asked to swap shifts with you on ${dto.workDate}`, dto.reason, transaction);
      return swap.id;
    });
    return this.get(auth, id);
  }

  /** The colleague agrees (it goes to the manager) or declines. */
  async respond(auth: AuthContext, id: string, dto: ShiftSwapResponseDto) {
    const self = await this.self(auth);
    await this.db.transaction(async (transaction) => {
      const swap = await ShiftSwap.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!swap || swap.colleagueId !== self.id) throw AppError.notFound('Shift swap');
      if (swap.status !== 'ASKED') throw AppError.conflict(`This swap is already ${swap.status.toLowerCase()}`);
      await swap.update({ status: dto.accept ? 'PENDING' : 'DECLINED', colleagueRespondedAt: new Date(), colleagueNote: dto.note ?? null }, { transaction });
      await this.audit.record({ action: dto.accept ? 'attendance.swap_accepted' : 'attendance.swap_declined', entityType: 'ShiftSwap', entityId: id, summary: `Shift swap on ${swap.workDate} ${dto.accept ? 'accepted' : 'declined'} by ${self.employeeCode}` }, transaction);
      await this.tellEmployee(swap.requesterId, swap, `${fullName(self)} ${dto.accept ? 'agreed to' : 'declined'} the shift swap on ${swap.workDate}`, dto.note ?? (dto.accept ? 'It now needs your manager’s approval.' : undefined), transaction);
      if (dto.accept) {
        const requester = (await Employee.findByPk(swap.requesterId, { attributes: ['id', 'firstName', 'lastName', 'managerId'], transaction }))!;
        for (const userId of await managerAndCover(requester.managerId, transaction)) {
          if (userId === auth.userId) continue;
          await this.notifications.notify(
            userId,
            { organizationId: swap.organizationId, type: 'attendance.swap', title: `${fullName(requester)} and ${fullName(self)} want to swap shifts on ${swap.workDate}`, body: swap.reason, link: '/hr/attendance/regularizations?tab=swaps' },
            transaction,
          );
        }
      }
    });
    return this.get(auth, id);
  }

  async approve(auth: AuthContext, id: string, dto: ReviewDto) {
    await this.review(auth, id, async (swap, requester, colleague, transaction) => {
      const [mine, theirs] = await this.shiftsOn([requester, colleague], swap.workDate);
      if (mine !== swap.requesterShiftId || theirs !== swap.colleagueShiftId) throw AppError.conflict('The roster for that day changed since the swap was asked for. Ask them to request it again.');
      await this.rules.assertOpen(swap.workDate);
      if (await AttendanceRecord.count({ where: { employeeId: [requester.id, colleague.id], workDate: swap.workDate }, transaction })) throw AppError.conflict('Attendance is already recorded for that day');
      await this.roster.setDay(swap.organizationId, requester.id, swap.workDate, swap.colleagueShiftId, auth.userId, transaction);
      await this.roster.setDay(swap.organizationId, colleague.id, swap.workDate, swap.requesterShiftId, auth.userId, transaction);
      await swap.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record({ action: 'attendance.swap_approved', entityType: 'ShiftSwap', entityId: id, summary: `Shift swap of ${requester.employeeCode} and ${colleague.employeeCode} on ${swap.workDate} approved` }, transaction);
      for (const e of [requester, colleague]) await this.tellEmployee(e.id, swap, `Your shift swap on ${swap.workDate} was approved`, 'The roster has been updated.', transaction);
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: ReviewDto) {
    if (!dto.note) throw AppError.validation([{ field: 'note', message: 'Say why the swap is not approved' }]);
    await this.review(auth, id, async (swap, requester, colleague, transaction) => {
      await swap.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record({ action: 'attendance.swap_rejected', entityType: 'ShiftSwap', entityId: id, summary: `Shift swap on ${swap.workDate} rejected` }, transaction);
      for (const e of [requester, colleague]) await this.tellEmployee(e.id, swap, `Your shift swap on ${swap.workDate} was not approved`, dto.note ?? undefined, transaction);
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string) {
    const self = await this.self(auth);
    await this.db.transaction(async (transaction) => {
      const swap = await ShiftSwap.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!swap || swap.requesterId !== self.id) throw AppError.notFound('Shift swap');
      if (!(OPEN as readonly string[]).includes(swap.status)) throw AppError.conflict(`This swap is already ${swap.status.toLowerCase()}`);
      await swap.update({ status: 'CANCELLED' }, { transaction });
      await this.tellEmployee(swap.colleagueId, swap, `${fullName(self)} withdrew the shift swap on ${swap.workDate}`, undefined, transaction);
    });
    return this.get(auth, id);
  }

  async list(auth: AuthContext, query: ShiftSwapQueryDto) {
    const self = await this.scope.self(auth);
    const filters: WhereOptions[] = [];
    if ((query.view ?? 'mine') === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ [Op.or]: [{ requesterId: self.id }, { colleagueId: self.id }] });
    } else {
      const scoped = await this.scope.where(auth, APPROVE, 'requesterId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(scoped, { status: { [Op.ne]: 'ASKED' } });
      if (self) filters.push({ requesterId: { [Op.ne]: self.id } }, { colleagueId: { [Op.ne]: self.id } });
    }
    if (query.status) filters.push({ status: query.status });
    const { rows, count } = await ShiftSwap.findAndCountAll({
      where: { [Op.and]: filters },
      include: [
        { model: Employee, as: 'requester', attributes: ATTRS },
        { model: Employee, as: 'colleague', attributes: ATTRS },
      ],
      order: [
        [literal(`CASE WHEN "ShiftSwap"."status" IN ('ASKED','PENDING') THEN 0 ELSE 1 END`), 'ASC'],
        ['workDate', 'ASC'],
      ],
      ...paginationArgs(query),
    });
    const ctx = await this.presentContext(rows);
    return new PaginatedResult(
      await Promise.all(rows.map((r) => this.present(auth, r, ctx, self?.id ?? null))),
      paginationMeta(query, count),
    );
  }

  // ---- Internals --------------------------------------------------------------------------------

  /** The shift each works that day (null = day off), by roster or their usual shift. */
  private async shiftsOn(employees: Employee[], date: string): Promise<(string | null)[]> {
    const contexts = await this.rules.contexts(employees[0]!.organizationId, employees, { from: date, to: date });
    return employees.map((e) => {
      const ctx = contexts.get(e.id)!;
      if (this.rules.isRestDay(ctx, date)) return null;
      const shift = this.rules.shiftOn(ctx, date);
      if (!shift.id) throw AppError.conflict('Set up shifts under Attendance → Shifts before swapping them');
      return shift.id;
    });
  }

  private async review(auth: AuthContext, id: string, fn: (swap: ShiftSwap, requester: Employee, colleague: Employee, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const swap = await ShiftSwap.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!swap) throw AppError.notFound('Shift swap');
      const [requester, colleague] = await Promise.all([Employee.findByPk(swap.requesterId, { attributes: ATTRS }), Employee.findByPk(swap.colleagueId, { attributes: ATTRS })]);
      if (!requester || !colleague || !(await this.scope.covers(auth, APPROVE, requester))) throw AppError.notFound('Shift swap');
      if (auth.membershipId && [requester.membershipId, colleague.membershipId].includes(auth.membershipId)) throw AppError.forbidden("You can't approve a swap you're part of");
      if (swap.status !== 'PENDING') throw AppError.conflict(swap.status === 'ASKED' ? 'The colleague has not agreed yet' : `This swap is already ${swap.status.toLowerCase()}`);
      await fn(swap, requester, colleague, transaction);
    });
  }

  private async self(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    return (await Employee.findByPk(self.id, { attributes: ATTRS }))!;
  }

  private async get(auth: AuthContext, id: string) {
    const swap = (await ShiftSwap.findByPk(id, {
      include: [
        { model: Employee, as: 'requester', attributes: ATTRS },
        { model: Employee, as: 'colleague', attributes: ATTRS },
      ],
    }))!;
    const self = await this.scope.self(auth);
    return this.present(auth, swap, await this.presentContext([swap]), self?.id ?? null);
  }

  private async presentContext(rows: ShiftSwap[]) {
    const shiftIds = [...new Set(rows.flatMap((r) => [r.requesterShiftId, r.colleagueShiftId]).filter((x): x is string => !!x))];
    const userIds = [...new Set(rows.map((r) => r.reviewedById).filter((x): x is string => !!x))];
    const [shifts, users] = await Promise.all([
      shiftIds.length ? Shift.findAll({ where: { id: shiftIds }, attributes: ['id', 'name', 'startTime', 'endTime'] }) : [],
      userIds.length ? User.findAll({ where: { id: userIds }, attributes: ['id', 'firstName', 'lastName'] }) : [],
    ]);
    return { shifts: new Map(shifts.map((s) => [s.id, s])), users: new Map(users.map((u) => [u.id, fullName(u)])) };
  }

  private async present(auth: AuthContext, r: ShiftSwap, ctx: Awaited<ReturnType<ShiftSwapsService['presentContext']>>, selfId: string | null) {
    const shift = (id: string | null) => {
      const s = id ? ctx.shifts.get(id) : null;
      return s ? { id: s.id, name: s.name, startTime: s.startTime.slice(0, 5), endTime: s.endTime.slice(0, 5) } : null;
    };
    const person = (e: Employee | undefined) => (e ? { id: e.id, name: fullName(e), employeeCode: e.employeeCode } : null);
    const involved = selfId === r.requesterId || selfId === r.colleagueId;
    const canReview = r.status === 'PENDING' && !involved && !!r.requester && (await this.scope.covers(auth, APPROVE, r.requester));
    return {
      id: r.id,
      workDate: r.workDate,
      requester: { ...person(r.requester), shift: shift(r.requesterShiftId) },
      colleague: { ...person(r.colleague), shift: shift(r.colleagueShiftId) },
      reason: r.reason,
      status: r.status,
      colleagueNote: r.colleagueNote,
      colleagueRespondedAt: r.colleagueRespondedAt,
      reviewNote: r.reviewNote,
      reviewedBy: r.reviewedById ? (ctx.users.get(r.reviewedById) ?? 'Former user') : null,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
      onBehalfOf: canReview && r.requester ? this.scope.delegatedBy(auth, APPROVE, r.requester) : null,
      permissions: {
        respond: r.status === 'ASKED' && selfId === r.colleagueId,
        cancel: (OPEN as readonly string[]).includes(r.status) && selfId === r.requesterId,
        review: canReview,
      },
    };
  }

  private async tellEmployee(employeeId: string, swap: ShiftSwap, title: string, body: string | undefined, transaction: Transaction) {
    const userId = (await userIdsOf([employeeId], transaction)).get(employeeId);
    if (userId) await this.notifications.notify(userId, { organizationId: swap.organizationId, type: 'attendance.swap', title, body, link: '/me/attendance?tab=swaps' }, transaction);
  }
}
