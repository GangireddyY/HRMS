import { Injectable, Logger } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { APPROVAL_DECIDE_PERMISSIONS, APPROVAL_SUBJECT_LABELS, APPROVAL_SUBJECT_PERMISSION, type ApprovalChainConditions, type ApprovalChainStep, type ApprovalFacts, type ApprovalSubject } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { RequestContext } from '../../common/context/request-context';
import { ApprovalChain, ApprovalInstance, Employee, MembershipRole, OrganizationMembership, Permission, RolePermission, User, type InstanceStep } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const CROSS = { skipTenantScope: true } as const;
type Requester = Pick<Employee, 'id' | 'managerId' | 'departmentId' | 'membershipId'>;

/** Whether the chain's conditions hold for the request (unset conditions always do). */
export function matches(c: ApprovalChainConditions, f: ApprovalFacts): boolean {
  if (c.minDays !== undefined && (f.days ?? 0) < c.minDays) return false;
  if (c.minAmount !== undefined && (f.amount ?? 0) < c.minAmount) return false;
  if (c.departmentIds?.length && (!f.departmentId || !c.departmentIds.includes(f.departmentId))) return false;
  if (c.leaveTypeIds?.length && (!f.leaveTypeId || !c.leaveTypeIds.includes(f.leaveTypeId))) return false;
  if (c.categories?.length && (!f.category || !c.categories.includes(f.category))) return false;
  return true;
}

/**
 * The "to approve" filter of a module list: requests in the caller's approval scope that don't follow a chain, plus
 * those whose current chain step the caller decides. `scoped` is the module's scope filter (`{}` = everything,
 * null = nothing); returns null when nothing can match.
 */
export function queueWhere(scoped: WhereOptions | null, waitingForMe: string[], chainManaged: string[]): WhereOptions | null {
  const unrestricted = !!scoped && Object.keys(scoped).length === 0 && Object.getOwnPropertySymbols(scoped).length === 0;
  const notManaged = chainManaged.length ? { id: { [Op.notIn]: chainManaged } } : null;
  let legacy: WhereOptions | null = null;
  if (scoped) {
    const parts = [...(unrestricted ? [] : [scoped]), ...(notManaged ? [notManaged] : [])];
    // Everything, not following a chain: no filter at all (an empty object inside OR would match nothing).
    if (!parts.length) return {};
    legacy = parts.length === 1 ? parts[0]! : { [Op.and]: parts };
  }
  const any = [...(legacy ? [legacy] : []), ...(waitingForMe.length ? [{ id: waitingForMe }] : [])];
  if (!any.length) return null;
  return any.length === 1 ? any[0]! : { [Op.or]: any };
}

export interface DecisionResult {
  /** The chain is complete (approved by the last step) or ended (rejected). */
  final: boolean;
  approved: boolean;
  /** Who decides next (memberships), when not final. */
  nextApprovers: string[];
  nextLabel: string | null;
}

/**
 * Configurable multi-level approval. A module asks `start` when a request is made: the first active chain for that kind
 * of request whose conditions match (by priority) is snapshotted with its approvers resolved (manager, skip-level,
 * permission holders for the requester's department, a named person). `canDecide` / `decide` then drive it step by
 * step; approval cover (delegation) lets a delegate act for an approver who is away, and a step past its deadline is
 * escalated to the next manager up and the organization-wide approvers (see ApprovalSlaJob). Without a matching chain
 * the module keeps its own built-in approval.
 */
@Injectable()
export class ApprovalChainsService {
  private readonly logger = new Logger(ApprovalChainsService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The chain that would apply to such a request (first active match by priority), without starting it. */
  async applies(subject: ApprovalSubject, facts: ApprovalFacts, transaction?: Transaction): Promise<ApprovalChain | null> {
    const chains = await ApprovalChain.findAll({ where: { subject, isActive: true }, order: [['priority', 'ASC'], ['createdAt', 'ASC']], transaction });
    return chains.find((c) => matches(c.conditions ?? {}, facts)) ?? null;
  }

  async start(subject: ApprovalSubject, subjectId: string, requester: Requester, facts: ApprovalFacts, transaction?: Transaction): Promise<ApprovalInstance | null> {
    const chain = await this.applies(subject, { departmentId: requester.departmentId, ...facts }, transaction);
    if (!chain) return null;
    // A request sent for approval again (an offer after changes) starts over; its finished round is replaced.
    await ApprovalInstance.destroy({ where: { subject, subjectId, status: { [Op.ne]: 'PENDING' } }, transaction });
    const steps: InstanceStep[] = [];
    const entitled = await this.entitled(subject, transaction);
    for (const s of chain.steps) {
      const approvers = (await this.resolve(s, requester, transaction)).filter((m) => m !== requester.membershipId && entitled.has(m));
      // A step nobody can decide (no manager, nobody holding the permission) is skipped rather than blocking forever.
      if (approvers.length) steps.push({ label: s.label, approverMembershipIds: approvers, escalatedMembershipIds: [], slaHours: s.slaHours ?? null });
    }
    if (!steps.length) return null;
    const now = new Date();
    const instance = await ApprovalInstance.create(
      {
        organizationId: RequestContext.organizationId()!,
        subject,
        subjectId,
        chainId: chain.id,
        chainName: chain.name,
        requesterMembershipId: requester.membershipId ?? null,
        steps,
        stepStartedAt: now,
        dueAt: this.due(steps[0]!, now),
      },
      { transaction },
    );
    return instance;
  }

  find(subject: ApprovalSubject, subjectId: string, transaction?: Transaction): Promise<ApprovalInstance | null> {
    return ApprovalInstance.findOne({ where: { subject, subjectId }, transaction });
  }

  /** The approver this caller acts for at the current step (themselves, or someone whose approvals they cover); null = they can't. */
  actingFor(auth: AuthContext, instance: ApprovalInstance): string | null {
    if (instance.status !== 'PENDING' || !auth.membershipId) return null;
    if (instance.requesterMembershipId && instance.requesterMembershipId === auth.membershipId) return null;
    if (instance.decisions.some((d) => d.membershipId === auth.membershipId || d.onBehalfOf === auth.membershipId)) return null;
    const step = instance.steps[instance.currentStep];
    if (!step) return null;
    const allowed = [...step.approverMembershipIds, ...step.escalatedMembershipIds];
    if (allowed.includes(auth.membershipId) && this.holdsDecidePermission(auth, instance.subject)) return auth.membershipId;
    const permission = APPROVAL_SUBJECT_PERMISSION[instance.subject];
    const cover = (auth.delegated ?? []).find((d) => d.permission === permission && allowed.includes(d.delegatorMembershipId));
    return cover?.delegatorMembershipId ?? null;
  }

  canDecide(auth: AuthContext, instance: ApprovalInstance | null): boolean {
    return !!instance && this.actingFor(auth, instance) !== null;
  }

  /** Why this caller can't decide (null = they can), for a clear 403. */
  blockReason(auth: AuthContext, instance: ApprovalInstance): string | null {
    if (this.actingFor(auth, instance)) return null;
    if (instance.status !== 'PENDING') return `This request is already ${instance.status.toLowerCase()}`;
    if (instance.decisions.some((d) => d.membershipId === auth.membershipId)) return 'You already decided an earlier step of this request';
    const step = instance.steps[instance.currentStep];
    if (step && auth.membershipId && [...step.approverMembershipIds, ...step.escalatedMembershipIds].includes(auth.membershipId) && !this.holdsDecidePermission(auth, instance.subject)) {
      return `Approving ${APPROVAL_SUBJECT_LABELS[instance.subject].toLowerCase()} needs the "${APPROVAL_DECIDE_PERMISSIONS[instance.subject][0]}" permission; ask an administrator`;
    }
    return `This request is waiting for ${instance.steps[instance.currentStep]?.label ?? 'another approver'}`;
  }

  /** Pending requests of this kind that follow a chain (the module's own approval doesn't apply to them). */
  async managedPending(subject: ApprovalSubject): Promise<string[]> {
    return (await ApprovalInstance.findAll({ where: { subject, status: 'PENDING' }, attributes: ['subjectId'] })).map((i) => i.subjectId);
  }

  /** Instances for several requests (lists). */
  async forMany(subject: ApprovalSubject, subjectIds: string[]): Promise<Map<string, ApprovalInstance>> {
    if (!subjectIds.length) return new Map();
    return new Map((await ApprovalInstance.findAll({ where: { subject, subjectId: subjectIds } })).map((i) => [i.subjectId, i]));
  }

  /** Requests of this kind waiting at a step this caller decides (for the modules' "to approve" lists). */
  async waitingFor(auth: AuthContext, subject: ApprovalSubject): Promise<string[]> {
    if (!auth.membershipId) return [];
    const pending = await ApprovalInstance.findAll({ where: { subject, status: 'PENDING' }, attributes: ['id', 'subject', 'subjectId', 'steps', 'currentStep', 'status', 'decisions', 'requesterMembershipId'] });
    return pending.filter((i) => this.actingFor(auth, i) !== null).map((i) => i.subjectId);
  }

  /** Kinds of request with something waiting at a step this caller decides (one query, for the approvals summary). */
  async subjectsWaitingFor(auth: AuthContext): Promise<Set<ApprovalSubject>> {
    if (!auth.membershipId) return new Set();
    const pending = await ApprovalInstance.findAll({ where: { status: 'PENDING' }, attributes: ['id', 'subject', 'subjectId', 'steps', 'currentStep', 'status', 'decisions', 'requesterMembershipId'] });
    return new Set(pending.filter((i) => this.actingFor(auth, i) !== null).map((i) => i.subject));
  }

  async decide(auth: AuthContext, instance: ApprovalInstance, decision: 'APPROVED' | 'REJECTED', note: string | null, transaction: Transaction): Promise<DecisionResult> {
    const fresh = await ApprovalInstance.findByPk(instance.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!fresh || fresh.status !== 'PENDING' || fresh.currentStep !== instance.currentStep) throw AppError.conflict('This request changed meanwhile; refresh and try again');
    const actingFor = this.actingFor(auth, fresh);
    if (!actingFor) throw AppError.forbidden(this.blockReason(auth, fresh) ?? 'You cannot decide this request');
    const user = await User.findByPk(auth.userId, { attributes: ['firstName', 'lastName'], transaction });
    const step = fresh.steps[fresh.currentStep]!;
    const decisions = [
      ...fresh.decisions,
      { step: fresh.currentStep, membershipId: auth.membershipId!, name: user ? fullName(user) : 'Approver', decision, note, at: new Date().toISOString(), onBehalfOf: actingFor === auth.membershipId ? null : actingFor },
    ];
    const last = fresh.currentStep >= fresh.steps.length - 1;
    if (decision === 'REJECTED' || last) {
      await fresh.update({ decisions, status: decision === 'REJECTED' ? 'REJECTED' : 'APPROVED', dueAt: null }, { transaction });
      return { final: true, approved: decision === 'APPROVED', nextApprovers: [], nextLabel: null };
    }
    const next = fresh.steps[fresh.currentStep + 1]!;
    const now = new Date();
    await fresh.update({ decisions, currentStep: fresh.currentStep + 1, stepStartedAt: now, dueAt: this.due(next, now), escalatedAt: null }, { transaction });
    await this.audit.record(
      { action: 'approvals.step_approved', entityType: 'ApprovalInstance', entityId: fresh.id, summary: `${APPROVAL_SUBJECT_LABELS[fresh.subject]}: "${step.label}" approved; waiting for ${next.label}` },
      transaction,
    );
    return { final: false, approved: false, nextApprovers: next.approverMembershipIds, nextLabel: next.label };
  }

  async cancel(subject: ApprovalSubject, subjectId: string, transaction?: Transaction): Promise<void> {
    await ApprovalInstance.update({ status: 'CANCELLED', dueAt: null }, { where: { subject, subjectId, status: 'PENDING' }, transaction });
  }

  /** The current step's approvers as users (for notifications). */
  async usersOf(membershipIds: string[], transaction?: Transaction): Promise<string[]> {
    if (!membershipIds.length) return [];
    const rows = await OrganizationMembership.findAll({ where: { id: membershipIds, status: 'ACTIVE' }, attributes: ['userId'], transaction });
    return [...new Set(rows.map((r) => r.userId))];
  }

  /** Progress for the request's detail view. */
  present(instance: ApprovalInstance | null) {
    if (!instance) return null;
    return {
      chain: instance.chainName,
      status: instance.status,
      currentStep: instance.currentStep,
      dueAt: instance.dueAt,
      escalated: !!instance.escalatedAt,
      steps: instance.steps.map((s, i) => ({ label: s.label, state: instance.status === 'APPROVED' || i < instance.currentStep ? 'done' : i === instance.currentStep && instance.status === 'PENDING' ? 'current' : instance.status === 'REJECTED' && i === instance.currentStep ? 'rejected' : 'upcoming' })),
      decisions: instance.decisions.map((d) => ({ step: d.step, name: d.name, decision: d.decision, note: d.note, at: d.at, onBehalf: !!d.onBehalfOf })),
    };
  }

  /**
   * Steps past their deadline (all organizations): the requester's next manager up and the organization-wide holders of
   * the approval permission may now decide too, and everyone involved is told. Each step escalates once.
   */
  async escalateOverdue(now = new Date()): Promise<number> {
    const due = await ApprovalInstance.findAll({ where: { status: 'PENDING', dueAt: { [Op.lte]: now }, escalatedAt: null }, ...CROSS });
    for (const instance of due) {
      try {
        await RequestContext.runForTenant(instance.organizationId, () => this.escalate(instance, now));
      } catch (e) {
        this.logger.warn(`Escalating approval ${instance.id} failed: ${(e as Error).message}`);
      }
    }
    return due.length;
  }

  private async escalate(instance: ApprovalInstance, now: Date): Promise<void> {
    // Claimed first, so with several servers each step escalates once.
    const [claimed] = await ApprovalInstance.update({ escalatedAt: now }, { where: { id: instance.id, status: 'PENDING', currentStep: instance.currentStep, escalatedAt: null } });
    if (!claimed) return;
    const step = instance.steps[instance.currentStep]!;
    const requester = instance.requesterMembershipId ? await Employee.findOne({ where: { membershipId: instance.requesterMembershipId }, attributes: ['id', 'managerId', 'departmentId', 'membershipId'] }) : null;
    const upward = requester ? await this.resolve({ label: '', approver: 'SKIP_MANAGER' }, requester) : [];
    const broad = await this.holders(APPROVAL_SUBJECT_PERMISSION[instance.subject], null, ['ORGANIZATION']);
    const entitled = await this.entitled(instance.subject);
    const added = [...new Set([...upward, ...broad])].filter((m) => !step.approverMembershipIds.includes(m) && m !== instance.requesterMembershipId && entitled.has(m));
    const steps = instance.steps.map((s, i) => (i === instance.currentStep ? { ...s, escalatedMembershipIds: [...new Set([...s.escalatedMembershipIds, ...added])] } : s));
    await ApprovalInstance.update({ steps }, { where: { id: instance.id } });
    await this.audit.record({ action: 'approvals.escalated', entityType: 'ApprovalInstance', entityId: instance.id, organizationId: instance.organizationId, actorUserId: null, summary: `${APPROVAL_SUBJECT_LABELS[instance.subject]}: "${step.label}" passed its deadline and was escalated` });
    const label = APPROVAL_SUBJECT_LABELS[instance.subject].toLowerCase().replace(/s$/, '');
    for (const userId of await this.usersOf([...step.approverMembershipIds, ...added])) {
      await this.notifications.notify(userId, { organizationId: instance.organizationId, type: 'approvals.escalated', title: `A ${label} is overdue for "${step.label}"`, body: `It has waited past its ${step.slaHours} h deadline and was escalated.`, link: '/me/approvals' });
    }
  }

  private due(step: InstanceStep, from: Date): Date | null {
    return step.slaHours ? new Date(from.getTime() + step.slaHours * 3_600_000) : null;
  }

  private async resolve(step: ApprovalChainStep, requester: Requester, transaction?: Transaction): Promise<string[]> {
    const membershipOf = async (employeeId: string | null | undefined) => {
      if (!employeeId) return null;
      const e = await Employee.findByPk(employeeId, { attributes: ['id', 'managerId', 'membershipId'], transaction });
      return e;
    };
    switch (step.approver) {
      case 'MANAGER': {
        const m = await membershipOf(requester.managerId);
        return m?.membershipId ? [m.membershipId] : [];
      }
      case 'SKIP_MANAGER': {
        const m = await membershipOf(requester.managerId);
        const skip = await membershipOf(m?.managerId);
        return skip?.membershipId ? [skip.membershipId] : [];
      }
      case 'PERMISSION':
        return step.permission ? this.holders(step.permission, requester.departmentId ?? null, ['ORGANIZATION', 'DEPARTMENT'], transaction) : [];
      case 'USER': {
        if (!step.membershipId) return [];
        const m = await OrganizationMembership.findOne({ where: { id: step.membershipId, status: 'ACTIVE' }, attributes: ['id'], transaction });
        return m ? [m.id] : [];
      }
    }
  }

  private holdsDecidePermission(auth: AuthContext, subject: ApprovalSubject): boolean {
    return APPROVAL_DECIDE_PERMISSIONS[subject].some((p) => auth.permissions.has(p));
  }

  /** Active members holding one of the subject's approve permissions at any scope (who may be an approver at all). */
  async entitled(subject: ApprovalSubject, transaction?: Transaction): Promise<Set<string>> {
    const permissions = await Permission.findAll({ where: { key: [...APPROVAL_DECIDE_PERMISSIONS[subject]] }, attributes: ['id'], transaction });
    if (!permissions.length) return new Set();
    const grants = await RolePermission.findAll({ where: { permissionId: permissions.map((p) => p.id) }, attributes: ['roleId'], transaction });
    if (!grants.length) return new Set();
    const links = await MembershipRole.findAll({ where: { roleId: [...new Set(grants.map((g) => g.roleId))] }, attributes: ['membershipId'], transaction });
    const members = await OrganizationMembership.findAll({ where: { id: [...new Set(links.map((l) => l.membershipId))], status: 'ACTIVE' }, attributes: ['id'], transaction });
    return new Set(members.map((m) => m.id));
  }

  /** Active members holding the permission organization-wide, or department-wide in the requester's department. */
  private async holders(key: string, departmentId: string | null, scopes: ('ORGANIZATION' | 'DEPARTMENT')[], transaction?: Transaction): Promise<string[]> {
    const permission = await Permission.findOne({ where: { key }, attributes: ['id'], transaction });
    if (!permission) return [];
    const grants = await RolePermission.findAll({ where: { permissionId: permission.id, scope: scopes }, attributes: ['roleId', 'scope'], transaction });
    if (!grants.length) return [];
    const scopeOf = new Map(grants.map((g) => [g.roleId, g.scope]));
    const links = await MembershipRole.findAll({ where: { roleId: [...scopeOf.keys()] }, attributes: ['membershipId', 'roleId'], transaction });
    const members = await OrganizationMembership.findAll({ where: { id: [...new Set(links.map((l) => l.membershipId))], status: 'ACTIVE' }, attributes: ['id'], transaction });
    const active = new Set(members.map((m) => m.id));
    const employees = await Employee.findAll({ where: { membershipId: [...active] }, attributes: ['membershipId', 'departmentId'], transaction });
    const deptOf = new Map(employees.map((e) => [e.membershipId!, e.departmentId]));
    const out = new Set<string>();
    for (const l of links) {
      if (!active.has(l.membershipId)) continue;
      const scope = scopeOf.get(l.roleId);
      if (scope === 'ORGANIZATION' || (scope === 'DEPARTMENT' && departmentId && deptOf.get(l.membershipId) === departmentId)) out.add(l.membershipId);
    }
    return [...out];
  }
}
