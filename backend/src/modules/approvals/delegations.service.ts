import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { DELEGABLE_LABELS, DELEGABLE_PERMISSIONS, DELEGATION_MAX_DAYS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { containsPattern } from '../../common/utils/like';
import { fullName } from '../../common/utils/names';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { ApprovalDelegation, Designation, Employee, OrganizationMembership } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { organizationToday } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateDelegationDto } from './delegations.dto';

type Status = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'REVOKED';
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Approval delegation: someone who approves for their team hands it to a colleague for a period (leave, holidays).
 * Only their own approval rights pass on (no chains), and only those in DELEGABLE_PERMISSIONS.
 */
@Injectable()
export class DelegationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The approvals the caller can hand over (their own, with more than their own record in scope). */
  delegable(auth: AuthContext) {
    return DELEGABLE_PERMISSIONS.filter((p) => {
      const scope = auth.permissions.get(p);
      return scope && scope !== 'OWN';
    });
  }

  async overview(auth: AuthContext) {
    const membershipId = auth.membershipId!;
    const today = await organizationToday(auth.organizationId!);
    const rows = await ApprovalDelegation.findAll({
      where: { [Op.or]: [{ delegatorMembershipId: membershipId }, { delegateMembershipId: membershipId }], endsOn: { [Op.gte]: addDays(today, -90) } },
      order: [['startsOn', 'DESC']],
      limit: 50,
    });
    const names = await this.names(rows.flatMap((r) => [r.delegatorMembershipId, r.delegateMembershipId]));
    const present = (r: ApprovalDelegation) => this.present(r, names, today, membershipId);
    return {
      today,
      maxDays: DELEGATION_MAX_DAYS,
      canDelegate: this.delegable(auth).length > 0,
      delegable: this.delegable(auth).map((p) => ({ key: p, label: DELEGABLE_LABELS[p] })),
      given: rows.filter((r) => r.delegatorMembershipId === membershipId).map(present),
      received: rows.filter((r) => r.delegateMembershipId === membershipId).map(present),
    };
  }

  /** Active colleagues who could take over (anyone signed in to the organization). */
  async candidates(auth: AuthContext, search?: string) {
    const filters = [{ membershipId: { [Op.ne]: null } }, { membershipId: { [Op.ne]: auth.membershipId } }, { status: { [Op.ne]: 'EXITED' } }];
    const text = search?.trim();
    const p = text ? containsPattern(text) : null;
    const rows = await Employee.findAll({
      where: { [Op.and]: [...filters, ...(p ? [{ [Op.or]: [{ firstName: { [Op.iLike]: p } }, { lastName: { [Op.iLike]: p } }, { employeeCode: { [Op.iLike]: p } }] }] : [])] },
      attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'membershipId'],
      include: [{ model: Designation, attributes: ['name'] }],
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
      limit: 20,
    });
    const active = new Set((await OrganizationMembership.findAll({ where: { id: rows.map((r) => r.membershipId!), status: 'ACTIVE' }, attributes: ['id'] })).map((m) => m.id));
    return rows.filter((r) => active.has(r.membershipId!)).map((r) => ({ employeeId: r.id, name: fullName(r), employeeCode: r.employeeCode, designation: r.designation?.name ?? null }));
  }

  async create(auth: AuthContext, dto: CreateDelegationDto) {
    const delegable = this.delegable(auth);
    if (!delegable.length) throw AppError.forbidden('You have no team approvals to hand over');
    const today = await organizationToday(auth.organizationId!);
    const issues = [];
    if (dto.startsOn < today) issues.push({ field: 'startsOn', message: "Start today or later; past days can't be delegated" });
    if (dto.endsOn < dto.startsOn) issues.push({ field: 'endsOn', message: "The last day can't be before the first" });
    else if (daysBetween(dto.startsOn, dto.endsOn) >= DELEGATION_MAX_DAYS) issues.push({ field: 'endsOn', message: `Delegate for at most ${DELEGATION_MAX_DAYS} days at a time` });
    if (dto.startsOn > addDays(today, 365)) issues.push({ field: 'startsOn', message: 'Start within the next year' });
    if (issues.length) throw AppError.validation(issues);

    const delegate = await Employee.findByPk(dto.delegateEmployeeId, { attributes: ['id', 'firstName', 'lastName', 'membershipId', 'status'] });
    const membership = delegate?.membershipId ? await OrganizationMembership.findByPk(delegate.membershipId, { attributes: ['id', 'userId', 'status'] }) : null;
    if (!delegate || !membership || membership.status !== 'ACTIVE' || delegate.status === 'EXITED')
      throw AppError.validation([{ field: 'delegateEmployeeId', message: "This person can't sign in, so they can't approve for you" }]);
    if (membership.id === auth.membershipId) throw AppError.validation([{ field: 'delegateEmployeeId', message: 'Choose someone else' }]);

    const id = await this.db.transaction(async (transaction) => {
      const clash = await ApprovalDelegation.findOne({
        where: { delegatorMembershipId: auth.membershipId!, revokedAt: null, startsOn: { [Op.lte]: dto.endsOn }, endsOn: { [Op.gte]: dto.startsOn } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (clash) throw AppError.conflict(`You already delegated ${clash.startsOn} – ${clash.endsOn}. Change or revoke that one first.`);
      const row = await ApprovalDelegation.create(
        {
          organizationId: auth.organizationId!,
          delegatorMembershipId: auth.membershipId!,
          delegateMembershipId: membership.id,
          startsOn: dto.startsOn,
          endsOn: dto.endsOn,
          reason: dto.reason ?? null,
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        {
          action: 'approval.delegated',
          entityType: 'ApprovalDelegation',
          entityId: row.id,
          summary: `Approvals delegated to ${fullName(delegate)} from ${dto.startsOn} to ${dto.endsOn}`,
          metadata: { permissions: delegable },
        },
        transaction,
      );
      await this.notifications.notify(
        membership.userId,
        {
          organizationId: auth.organizationId,
          type: 'approvals.delegation',
          title: `${(await this.names([auth.membershipId!])).get(auth.membershipId!) ?? 'A colleague'} asked you to approve on their behalf`,
          body: `${dto.startsOn} to ${dto.endsOn}: ${delegable.map((p) => DELEGABLE_LABELS[p]).join(', ')}.${dto.reason ? ` ${dto.reason}` : ''}`,
          link: '/me/delegation',
        },
        transaction,
      );
      return row.id;
    });
    return this.one(auth, id);
  }

  /** The delegator ends it early, or the delegate declines it. */
  async revoke(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const row = await ApprovalDelegation.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row || (row.delegatorMembershipId !== auth.membershipId && row.delegateMembershipId !== auth.membershipId)) throw AppError.notFound('Delegation');
      if (row.revokedAt) throw AppError.conflict('This delegation was already ended');
      const today = await organizationToday(auth.organizationId!);
      if (row.endsOn < today) throw AppError.conflict('This delegation has already ended');
      await row.update({ revokedAt: new Date(), revokedById: auth.userId }, { transaction });
      await this.audit.record(
        {
          action: 'approval.delegation_revoked',
          entityType: 'ApprovalDelegation',
          entityId: id,
          summary: `Approval delegation ${row.startsOn} – ${row.endsOn} ended ${row.delegateMembershipId === auth.membershipId ? 'by the delegate' : 'early'}`,
        },
        transaction,
      );
    });
    return this.one(auth, id);
  }

  private async one(auth: AuthContext, id: string) {
    const row = (await ApprovalDelegation.findByPk(id))!;
    const names = await this.names([row.delegatorMembershipId, row.delegateMembershipId]);
    return this.present(row, names, await organizationToday(auth.organizationId!), auth.membershipId!);
  }

  private present(r: ApprovalDelegation, names: Map<string, string>, today: string, membershipId: string) {
    const status: Status = r.revokedAt ? 'REVOKED' : r.endsOn < today ? 'ENDED' : r.startsOn > today ? 'SCHEDULED' : 'ACTIVE';
    return {
      id: r.id,
      delegator: names.get(r.delegatorMembershipId) ?? 'Former member',
      delegate: names.get(r.delegateMembershipId) ?? 'Former member',
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      reason: r.reason,
      status,
      canEnd: (status === 'ACTIVE' || status === 'SCHEDULED') && (r.delegatorMembershipId === membershipId || r.delegateMembershipId === membershipId),
    };
  }

  /** Display names by membership: the employee name, else the user's. */
  private async names(membershipIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(membershipIds)];
    const out = new Map<string, string>();
    if (!ids.length) return out;
    for (const e of await Employee.findAll({ where: { membershipId: ids }, attributes: ['membershipId', 'firstName', 'lastName'] })) out.set(e.membershipId!, fullName(e));
    const missing = ids.filter((id) => !out.has(id));
    if (missing.length) {
      const memberships = await OrganizationMembership.findAll({ where: { id: missing }, include: ['user'] });
      for (const m of memberships) if (m.user) out.set(m.id, fullName(m.user));
    }
    return out;
  }
}
