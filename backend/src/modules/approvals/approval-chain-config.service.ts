import { Injectable } from '@nestjs/common';
import { isKnownPermission, type ApprovalChainStep } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { ApprovalChain, ApprovalInstance, OrganizationMembership, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { ApprovalChainDto, ApprovalChainQueryDto } from './approval-chains.dto';

/** Defining approval chains (`approvals.configure`): steps, conditions, priority. Requests in progress keep their snapshot. */
@Injectable()
export class ApprovalChainConfigService {
  constructor(private readonly audit: AuditService) {}

  async list(query: ApprovalChainQueryDto) {
    const chains = await ApprovalChain.findAll({ where: query.subject ? { subject: query.subject } : {}, order: [['subject', 'ASC'], ['priority', 'ASC'], ['createdAt', 'ASC']] });
    const memberships = [...new Set(chains.flatMap((c) => c.steps.map((s) => s.membershipId).filter((x): x is string => !!x)))];
    const names = await this.memberNames(memberships);
    const inFlight = new Map(
      ((await ApprovalInstance.count({ where: { status: 'PENDING', chainId: chains.map((c) => c.id) }, group: ['chainId'] })) as unknown as { chainId: string; count: number }[]).map((r) => [r.chainId, Number(r.count)]),
    );
    return chains.map((c) => ({
      id: c.id,
      subject: c.subject,
      name: c.name,
      priority: c.priority,
      conditions: c.conditions ?? {},
      steps: c.steps.map((s) => ({ ...s, approverName: s.membershipId ? (names.get(s.membershipId) ?? null) : null })),
      isActive: c.isActive,
      pending: inFlight.get(c.id) ?? 0,
      updatedAt: c.updatedAt,
    }));
  }

  async create(auth: AuthContext, dto: ApprovalChainDto) {
    await this.check(dto.steps);
    const chain = await ApprovalChain.create({ organizationId: auth.organizationId!, subject: dto.subject, name: dto.name, priority: dto.priority ?? 100, conditions: dto.conditions ?? {}, steps: dto.steps, isActive: dto.isActive ?? true, createdById: auth.userId, updatedById: auth.userId });
    await this.audit.record({ action: 'approvals.chain_created', entityType: 'ApprovalChain', entityId: chain.id, summary: `Approval chain "${chain.name}" (${chain.steps.length} steps) created`, metadata: { subject: chain.subject } });
    return (await this.list({ subject: chain.subject })).find((c) => c.id === chain.id)!;
  }

  async update(auth: AuthContext, id: string, dto: ApprovalChainDto) {
    const chain = await ApprovalChain.findByPk(id);
    if (!chain) throw AppError.notFound('Approval chain');
    await this.check(dto.steps);
    await chain.update({ subject: dto.subject, name: dto.name, priority: dto.priority ?? chain.priority, conditions: dto.conditions ?? {}, steps: dto.steps, isActive: dto.isActive ?? chain.isActive, updatedById: auth.userId });
    await this.audit.record({ action: 'approvals.chain_updated', entityType: 'ApprovalChain', entityId: id, summary: `Approval chain "${chain.name}" updated` });
    return (await this.list({ subject: chain.subject })).find((c) => c.id === chain.id)!;
  }

  async remove(auth: AuthContext, id: string) {
    const chain = await ApprovalChain.findByPk(id);
    if (!chain) throw AppError.notFound('Approval chain');
    await chain.destroy();
    await this.audit.record({ action: 'approvals.chain_deleted', entityType: 'ApprovalChain', entityId: id, summary: `Approval chain "${chain.name}" deleted (requests in progress finish with it)` });
  }

  private async check(steps: ApprovalChainStep[]) {
    for (const [i, s] of steps.entries()) {
      const field = `steps.${i}`;
      if (s.approver === 'PERMISSION' && (!s.permission || !isKnownPermission(s.permission))) throw AppError.validation([{ field: `${field}.permission`, message: 'Choose a permission' }]);
      if (s.approver === 'USER') {
        if (!s.membershipId) throw AppError.validation([{ field: `${field}.membershipId`, message: 'Choose the approver' }]);
        if (!(await OrganizationMembership.findOne({ where: { id: s.membershipId, status: 'ACTIVE' }, attributes: ['id'] }))) throw AppError.validation([{ field: `${field}.membershipId`, message: 'That person is not an active member' }]);
      }
    }
  }

  private async memberNames(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const members = await OrganizationMembership.findAll({ where: { id: ids }, attributes: ['id', 'userId'] });
    const users = new Map((await User.findAll({ where: { id: members.map((m) => m.userId) }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
    return new Map(members.map((m) => [m.id, users.get(m.userId) ?? 'Member']));
  }
}
