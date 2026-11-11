import { Injectable } from '@nestjs/common';
import { literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { fullName } from '../../common/utils/names';
import { allocateReference } from '../../common/utils/reference';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, TravelRequest } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { managerAndCover, organizationToday, userIdsOf, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { NoteDto, OptionalNoteDto, TravelDeskDto, TravelQueryDto, TravelRequestDto } from './services.dto';
import { userNames } from './service-people';

const EMPLOYEE_ATTRS = ['id', 'employeeCode', 'firstName', 'lastName', 'status', 'managerId', 'departmentId', 'membershipId'];
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Business travel: an employee asks to travel (`travel.request`) with the purpose, dates, mode and an estimate,
 * optionally asking for an advance; their manager — anyone with `travel.approve` in scope, or someone covering for
 * them, never the traveller — approves it. The travel desk (`travel.manage`) then records bookings and pays the
 * advance; after the trip the employee claims actual expenses as a reimbursement and marks the trip complete.
 */
@Injectable()
export class TravelService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
    private readonly chains: ApprovalChainsService,
  ) {}

  async create(auth: AuthContext, dto: TravelRequestDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can request travel');
    if (self.status === 'EXITED' || self.status === 'ON_NOTICE') throw AppError.forbidden(self.status === 'EXITED' ? 'You have exited the organization' : "Travel can't be requested while serving notice");
    const today = await organizationToday(auth.organizationId!);
    if (dto.departureDate < today) throw AppError.validation([{ field: 'departureDate', message: "Can't be in the past" }]);
    if (dto.returnDate < dto.departureDate) throw AppError.validation([{ field: 'returnDate', message: "Can't be before departure" }]);
    if ((dto.advanceAmount ?? 0) > dto.estimatedCost) throw AppError.validation([{ field: 'advanceAmount', message: "Can't be more than the estimated cost" }]);
    const id = await this.db.transaction(async (transaction) => {
      const reference = await allocateReference(this.db.sequelize, transaction, auth.organizationId!, 'TR', async () =>
        (await TravelRequest.findAll({ attributes: ['reference'], raw: true, transaction })).map((r) => r.reference),
      );
      const r = await TravelRequest.create(
        {
          organizationId: auth.organizationId!,
          reference,
          employeeId: self.id,
          requestedById: auth.userId,
          purpose: dto.purpose,
          fromCity: dto.fromCity,
          toCity: dto.toCity,
          departureDate: dto.departureDate,
          returnDate: dto.returnDate,
          mode: dto.mode,
          needsAccommodation: !!dto.needsAccommodation,
          estimatedCost: String(dto.estimatedCost),
          advanceAmount: String(dto.advanceAmount ?? 0),
        },
        { transaction },
      );
      await this.audit.record(
        { action: 'travel.requested', entityType: 'TravelRequest', entityId: r.id, summary: `${reference}: ${dto.fromCity} → ${dto.toCity}, ${dto.departureDate} to ${dto.returnDate}` },
        transaction,
      );
      // A configured approval chain, when one applies, replaces the single manager approval.
      const requester = await Employee.findByPk(self.id, { attributes: ['id', 'managerId', 'departmentId', 'membershipId'], transaction });
      const chain = await this.chains.start('TRAVEL', r.id, requester!, { amount: dto.estimatedCost }, transaction);
      const approvers = chain ? await this.chains.usersOf(chain.steps[0]!.approverMembershipIds, transaction) : await managerAndCover(self.managerId, transaction);
      for (const userId of approvers.length ? approvers : await usersWithPermission('travel.approve', transaction, ['ORGANIZATION'])) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(
          userId,
          {
            organizationId: auth.organizationId,
            type: 'travel.request',
            title: `${fullName(self)} asked to travel to ${dto.toCity} (${dto.departureDate})`,
            body: `${dto.purpose} · estimate ${money(dto.estimatedCost)}${dto.advanceAmount ? `, advance ${money(dto.advanceAmount)}` : ''}`,
            link: '/hr/travel?view=team',
          },
          transaction,
        );
      }
      return r.id;
    });
    return this.get(auth, id);
  }

  async list(auth: AuthContext, query: TravelQueryDto) {
    const self = await this.scope.self(auth);
    const view = query.view ?? 'mine';
    const filters: WhereOptions[] = [];
    if (view === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    } else if (view === 'team') {
      // Requests on an approval chain show for their current step's approvers only (and stay visible in scope once decided).
      const [scoped, mine, managed] = await Promise.all([this.scope.where(auth, 'travel.approve', 'employeeId'), this.chains.waitingFor(auth, 'TRAVEL'), this.chains.managedPending('TRAVEL')]);
      const legacy = scoped ? (managed.length ? { [Op.and]: [scoped, { id: { [Op.notIn]: managed } }] } : scoped) : null;
      const any = [...(legacy ? [legacy] : []), ...(mine.length ? [{ id: mine }] : [])];
      if (!any.length) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ [Op.or]: any });
      if (self) filters.push({ employeeId: { [Op.ne]: self.id } });
    } else if (!auth.permissions.has('travel.manage')) throw AppError.forbidden();
    if (query.status) filters.push({ status: query.status });
    if (query.search) {
      const like = containsPattern(query.search);
      filters.push({
        [Op.or]: [
          { reference: { [Op.iLike]: like } },
          { toCity: { [Op.iLike]: like } },
          { fromCity: { [Op.iLike]: like } },
          { purpose: { [Op.iLike]: like } },
          { '$employee.first_name$': { [Op.iLike]: like } },
          { '$employee.last_name$': { [Op.iLike]: like } },
        ],
      });
    }
    const { rows, count } = await TravelRequest.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, attributes: EMPLOYEE_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] }],
      order: [
        [literal(`CASE WHEN "TravelRequest"."status" = 'PENDING' THEN 0 WHEN "TravelRequest"."status" = 'APPROVED' THEN 1 ELSE 2 END`), 'ASC'],
        ['departureDate', view === 'mine' ? 'DESC' : 'ASC'],
      ],
      subQuery: false,
      ...paginationArgs(query),
    });
    const names = await userNames(rows.map((r) => r.reviewedById));
    const today = await organizationToday(auth.organizationId!);
    const chains = await this.chains.forMany('TRAVEL', rows.map((r) => r.id));
    return new PaginatedResult(
      await Promise.all(rows.map((r) => this.present(auth, r, names, self?.id ?? null, today, chains.get(r.id) ?? null))),
      paginationMeta(query, count),
    );
  }

  async get(auth: AuthContext, id: string) {
    const r = await TravelRequest.findByPk(id, { include: [{ model: Employee, attributes: EMPLOYEE_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] }] });
    if (!r) throw AppError.notFound('Travel request');
    const self = await this.scope.self(auth);
    const own = self?.id === r.employeeId;
    const chain = await this.chains.find('TRAVEL', id);
    const onChain = !!chain && (this.chains.canDecide(auth, chain) || chain.decisions.some((d) => d.membershipId === auth.membershipId));
    if (!own && !onChain && !auth.permissions.has('travel.manage') && !(await this.scope.covers(auth, 'travel.approve', r.employee!))) throw AppError.notFound('Travel request');
    return this.present(auth, r, await userNames([r.reviewedById]), self?.id ?? null, await organizationToday(auth.organizationId!), chain);
  }

  async approve(auth: AuthContext, id: string, dto: OptionalNoteDto) {
    await this.review(auth, id, 'APPROVED', dto.note ?? null, async (r, transaction) => {
      await r.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record({ action: 'travel.approved', entityType: 'TravelRequest', entityId: id, summary: `${r.reference} approved` }, transaction);
      await this.tell(r, `Your trip ${r.reference} to ${r.toCity} was approved`, dto.note ?? (Number(r.advanceAmount) ? 'The travel desk will arrange bookings and your advance.' : undefined), transaction);
      for (const userId of await usersWithPermission('travel.manage', transaction)) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(
          userId,
          { organizationId: r.organizationId, type: 'travel.desk', title: `${r.reference} approved: ${fullName(r.employee!)} to ${r.toCity} on ${r.departureDate}`, body: r.purpose, link: '/hr/travel?view=all' },
          transaction,
        );
      }
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: NoteDto) {
    await this.review(auth, id, 'REJECTED', dto.note, async (r, transaction) => {
      await r.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { transaction });
      await this.audit.record({ action: 'travel.rejected', entityType: 'TravelRequest', entityId: id, summary: `${r.reference} rejected` }, transaction);
      await this.tell(r, `Your trip ${r.reference} to ${r.toCity} was not approved`, dto.note, transaction);
    });
    return this.get(auth, id);
  }

  /** The traveller withdraws a pending or approved trip before it starts. */
  async cancel(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    const today = await organizationToday(auth.organizationId!);
    await this.db.transaction(async (transaction) => {
      const r = await TravelRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r || !self || r.employeeId !== self.id) throw AppError.notFound('Travel request');
      if (r.status !== 'PENDING' && r.status !== 'APPROVED') throw AppError.conflict(`This trip is already ${r.status.toLowerCase()}`);
      if (r.status === 'APPROVED' && r.departureDate <= today) throw AppError.conflict('The trip has started. Mark it complete instead.');
      await r.update({ status: 'CANCELLED' }, { transaction });
      await this.chains.cancel('TRAVEL', id, transaction);
      await this.audit.record({ action: 'travel.cancelled', entityType: 'TravelRequest', entityId: id, summary: `${r.reference} cancelled` }, transaction);
      if (r.reviewedById && r.reviewedById !== auth.userId) {
        await this.notifications.notify(r.reviewedById, { organizationId: r.organizationId, type: 'travel.request', title: `${self.firstName} cancelled the trip ${r.reference}`, link: '/hr/travel?view=team' }, transaction);
      }
    });
    return this.get(auth, id);
  }

  /** After the trip has started; actual expenses go in a reimbursement claim. */
  async complete(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    const today = await organizationToday(auth.organizationId!);
    await this.db.transaction(async (transaction) => {
      const r = await TravelRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      const own = !!self && r?.employeeId === self.id;
      if (!r || (!own && !auth.permissions.has('travel.manage'))) throw AppError.notFound('Travel request');
      if (r.status !== 'APPROVED') throw AppError.conflict('Only an approved trip can be completed');
      if (r.departureDate > today) throw AppError.conflict("The trip hasn't started yet");
      await r.update({ status: 'COMPLETED', completedAt: new Date() }, { transaction });
      await this.audit.record({ action: 'travel.completed', entityType: 'TravelRequest', entityId: id, summary: `${r.reference} completed` }, transaction);
    });
    return this.get(auth, id);
  }

  /** Travel desk: booking details for the traveller, and the advance payment. */
  async desk(auth: AuthContext, id: string, dto: TravelDeskDto) {
    await this.db.transaction(async (transaction) => {
      const r = await TravelRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r) throw AppError.notFound('Travel request');
      if (r.status !== 'APPROVED' && r.status !== 'COMPLETED') throw AppError.conflict('Bookings are recorded for approved trips');
      const changes: Partial<TravelRequest> = {};
      const said: string[] = [];
      if (dto.bookingNotes !== undefined && dto.bookingNotes !== r.bookingNotes) {
        changes.bookingNotes = dto.bookingNotes;
        said.push('bookings updated');
      }
      if (dto.advanceReference) {
        if (!Number(r.advanceAmount)) throw AppError.validation([{ field: 'advanceReference', message: 'No advance was asked for on this trip' }]);
        if (r.advancePaidAt) throw AppError.conflict('The advance is already paid');
        changes.advanceReference = dto.advanceReference;
        changes.advancePaidAt = new Date();
        said.push(`advance of ${money(Number(r.advanceAmount))} paid (${dto.advanceReference})`);
      }
      if (!said.length) return;
      await r.update(changes, { transaction });
      await this.audit.record({ action: 'travel.desk_updated', entityType: 'TravelRequest', entityId: id, summary: `${r.reference}: ${said.join('; ')}` }, transaction);
      await this.tell(r, changes.advancePaidAt ? `Your travel advance for ${r.reference} has been paid` : `Bookings for ${r.reference} are ready`, changes.bookingNotes ?? undefined, transaction);
    });
    return this.get(auth, id);
  }

  /**
   * One decision. On an approval chain the current step's approvers decide, and `onFinal` runs only for the last approval
   * (or a rejection); otherwise anyone with `travel.approve` covering the traveller decides at once.
   */
  private async review(auth: AuthContext, id: string, decision: 'APPROVED' | 'REJECTED', note: string | null, onFinal: (r: TravelRequest, transaction: Transaction) => Promise<void>) {
    if (!auth.features.has('travel')) throw AppError.forbidden('Travel is not enabled for this organization');
    let next: { approvers: string[]; label: string } | null = null;
    let request: TravelRequest | null = null;
    await this.db.transaction(async (transaction) => {
      const r = await TravelRequest.findByPk(id, {
        include: [{ model: Employee, attributes: EMPLOYEE_ATTRS }],
        transaction,
        lock: { level: transaction.LOCK.UPDATE, of: TravelRequest },
      });
      if (!r) throw AppError.notFound('Travel request');
      const chain = await this.chains.find('TRAVEL', id, transaction);
      const onChain = chain?.status === 'PENDING';
      if (onChain) {
        const blocked = this.chains.blockReason(auth, chain);
        if (blocked) {
          if (await this.scope.covers(auth, 'travel.approve', r.employee!)) throw AppError.forbidden(blocked);
          throw AppError.notFound('Travel request');
        }
      } else {
        const approves = auth.permissions.has('travel.approve') || (auth.delegated ?? []).some((d) => d.permission === 'travel.approve');
        if (!approves) throw AppError.forbidden();
        if (!(await this.scope.covers(auth, 'travel.approve', r.employee!))) throw AppError.notFound('Travel request');
      }
      if (auth.membershipId && r.employee!.membershipId === auth.membershipId) throw AppError.forbidden("You can't approve your own travel");
      if (r.status !== 'PENDING') throw AppError.conflict(`This request is already ${r.status.toLowerCase()}`);
      if (onChain) {
        const result = await this.chains.decide(auth, chain, decision, note, transaction);
        if (!result.final) {
          next = { approvers: result.nextApprovers, label: result.nextLabel! };
          request = r;
          await this.audit.record({ action: 'travel.step_approved', entityType: 'TravelRequest', entityId: id, summary: `${r.reference} approved; ${result.nextLabel} next` }, transaction);
          await this.tell(r, `Your trip ${r.reference} was approved; ${result.nextLabel} approves next`, note ?? undefined, transaction);
          return;
        }
      }
      await onFinal(r, transaction);
    });
    const pending = next as { approvers: string[]; label: string } | null;
    const r = request as TravelRequest | null;
    if (pending && r) {
      for (const userId of await this.chains.usersOf(pending.approvers)) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(userId, { organizationId: r.organizationId, type: 'travel.request', title: `${pending.label} approval needed: ${fullName(r.employee!)} to ${r.toCity} (${r.departureDate})`, body: r.purpose, link: '/hr/travel?view=team' });
      }
    }
  }

  private async tell(r: TravelRequest, title: string, body: string | undefined, transaction: Transaction) {
    const userId = (await userIdsOf([r.employeeId], transaction)).get(r.employeeId);
    if (userId) await this.notifications.notify(userId, { organizationId: r.organizationId, type: 'travel.request', title, body, link: '/me/travel' }, transaction);
  }

  private async present(auth: AuthContext, r: TravelRequest, names: Map<string, string>, selfId: string | null, today: string, chain: ApprovalInstance | null = null) {
    const own = r.employeeId === selfId;
    const onChain = chain?.status === 'PENDING';
    const canReview = r.status === 'PENDING' && !own && !!r.employee && (onChain ? this.chains.canDecide(auth, chain) : await this.scope.covers(auth, 'travel.approve', r.employee));
    return {
      id: r.id,
      reference: r.reference,
      employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode, department: r.employee.department?.name ?? null } : null,
      purpose: r.purpose,
      fromCity: r.fromCity,
      toCity: r.toCity,
      departureDate: r.departureDate,
      returnDate: r.returnDate,
      mode: r.mode,
      needsAccommodation: r.needsAccommodation,
      estimatedCost: Number(r.estimatedCost),
      advanceAmount: Number(r.advanceAmount),
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedBy: r.reviewedById ? (names.get(r.reviewedById) ?? 'Former user') : null,
      reviewedAt: r.reviewedAt,
      onBehalfOf: canReview && r.employee ? this.scope.delegatedBy(auth, 'travel.approve', r.employee) : null,
      bookingNotes: r.bookingNotes,
      advancePaidAt: r.advancePaidAt,
      advanceReference: r.advanceReference,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      chain: this.chains.present(chain),
      permissions: {
        approve: canReview,
        cancel: own && (r.status === 'PENDING' || (r.status === 'APPROVED' && r.departureDate > today)),
        complete: (own || auth.permissions.has('travel.manage')) && r.status === 'APPROVED' && r.departureDate <= today,
        desk: auth.permissions.has('travel.manage') && (r.status === 'APPROVED' || r.status === 'COMPLETED'),
      },
    };
  }
}
