import { Injectable } from '@nestjs/common';
import { col, fn, Op, UniqueConstraintError } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { monthRange } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceOvertime, AttendancePeriod, AttendanceRecord, AttendanceRegularization, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { AttendanceRulesService } from './attendance-rules.service';

/** Monthly closing: once closed, the month's attendance can't be punched, corrected or regularized. */
@Injectable()
export class AttendancePeriodsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AttendanceRulesService,
  ) {}

  async list(auth: AuthContext, year: number) {
    const today = this.rules.today(await this.rules.organizationTimeZone(auth.organizationId!));
    const pendingByMonthOf = (model: typeof AttendanceRegularization | typeof AttendanceOvertime) =>
      (model as typeof AttendanceRegularization).findAll({
        attributes: [[fn('to_char', col('work_date'), 'MM'), 'month'], [fn('COUNT', col('id')), 'count']],
        where: { status: 'PENDING', workDate: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] } },
        group: [fn('to_char', col('work_date'), 'MM')],
        raw: true,
      }) as unknown as Promise<{ month: string; count: string }[]>;
    const [closed, pending, pendingOvertime] = await Promise.all([AttendancePeriod.findAll({ where: { year } }), pendingByMonthOf(AttendanceRegularization), pendingByMonthOf(AttendanceOvertime)]);
    const closers = new Map((await User.findAll({ where: { id: closed.map((c) => c.closedById).filter((x): x is string => !!x) }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const byMonth = new Map(closed.map((c) => [c.month, c]));
    const pendingByMonth = new Map(pending.map((p) => [Number(p.month), Number(p.count)]));
    const overtimeByMonth = new Map(pendingOvertime.map((p) => [Number(p.month), Number(p.count)]));
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const { to } = monthRange(year, month);
      const period = byMonth.get(month);
      return {
        year,
        month,
        ended: to < today,
        closed: !!period,
        closedAt: period?.closedAt ?? null,
        closedBy: period?.closedById ? (closers.get(period.closedById) ?? null) : null,
        summary: period?.summary ?? null,
        pendingRegularizations: pendingByMonth.get(month) ?? 0,
        pendingOvertime: overtimeByMonth.get(month) ?? 0,
      };
    });
  }

  async close(auth: AuthContext, year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const today = this.rules.today(await this.rules.organizationTimeZone(auth.organizationId!));
    if (to >= today) throw AppError.validation([{ field: 'month', message: 'A month can only be closed after it has ended' }]);
    const pending = await AttendanceRegularization.count({ where: { status: 'PENDING', workDate: { [Op.between]: [from, to] } } });
    if (pending) throw AppError.conflict(`${pending} regularization request${pending === 1 ? ' is' : 's are'} still pending for this month. Approve or reject them first.`);
    const pendingOvertime = await AttendanceOvertime.count({ where: { status: 'PENDING', workDate: { [Op.between]: [from, to] } } });
    if (pendingOvertime) throw AppError.conflict(`${pendingOvertime} overtime entr${pendingOvertime === 1 ? 'y is' : 'ies are'} still waiting for approval this month. Approve or reject them first.`);

    const records = await AttendanceRecord.findAll({ where: { workDate: { [Op.between]: [from, to] } }, attributes: ['status', 'checkOutAt', 'lateMinutes', 'overtimeMinutes', 'workMode'], raw: true });
    const summary = {
      records: records.length,
      present: records.filter((r) => r.status === 'PRESENT').length,
      halfDay: records.filter((r) => r.status === 'HALF_DAY').length,
      absent: records.filter((r) => r.status === 'ABSENT').length,
      missedPunch: records.filter((r) => !r.checkOutAt).length,
      late: records.filter((r) => r.lateMinutes > 0).length,
      remote: records.filter((r) => r.workMode === 'REMOTE').length,
      overtimeMinutes: records.reduce((n, r) => n + (r.overtimeMinutes ?? 0), 0),
    };
    try {
      await this.db.transaction(async (transaction) => {
        await AttendancePeriod.create({ organizationId: auth.organizationId!, year, month, closedById: auth.userId, summary }, { transaction });
        await this.audit.record({ action: 'attendance.month_closed', entityType: 'AttendancePeriod', summary: `Attendance for ${year}-${String(month).padStart(2, '0')} closed`, metadata: summary }, transaction);
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('This month is already closed');
      throw e;
    }
    return (await this.list(auth, year))[month - 1];
  }

  async reopen(auth: AuthContext, year: number, month: number) {
    const period = await AttendancePeriod.findOne({ where: { year, month } });
    if (!period) throw AppError.conflict('This month is not closed');
    await this.db.transaction(async (transaction) => {
      await period.destroy({ transaction });
      await this.audit.record({ action: 'attendance.month_reopened', entityType: 'AttendancePeriod', summary: `Attendance for ${year}-${String(month).padStart(2, '0')} reopened` }, transaction);
    });
    return (await this.list(auth, year))[month - 1];
  }
}
