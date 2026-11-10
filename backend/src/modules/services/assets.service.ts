import { Injectable } from '@nestjs/common';
import { literal, Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { ASSET_CATEGORY_LABELS, type AssetCondition } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { fullName } from '../../common/utils/names';
import { allocateReference } from '../../common/utils/reference';
import { DatabaseService } from '../../database/database.service';
import { Asset, AssetAssignment, AssetRequest, Department, Employee, Location } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { userIdsOf, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AssetDto,
  AssetQueryDto,
  AssetRequestDto,
  AssetRequestQueryDto,
  AssetStatusDto,
  AssignAssetDto,
  FulfilAssetRequestDto,
  NoteDto,
  ReturnAssetDto,
  UpdateAssetDto,
} from './services.dto';
import { userNames } from './service-people';

const EMPLOYEE_ATTRS = ['id', 'employeeCode', 'firstName', 'lastName', 'status', 'managerId', 'departmentId', 'membershipId'];
const person = (e: Employee | null | undefined) => (e ? { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null } : null);

/**
 * The asset register: company equipment with its assignment history. People with `assets.manage` add assets, hand
 * them to employees and take them back (recording the condition both ways); employees see what they hold, confirm
 * they received it and ask for something new (`assets.request`). Managers with `assets.view` see what their people
 * hold. An exit can't be completed while the employee still holds an asset.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Register ---------------------------------------------------------------------------------

  async list(auth: AuthContext, query: AssetQueryDto) {
    const filters: WhereOptions[] = [];
    if (!auth.permissions.has('assets.manage')) {
      const scoped = await this.scope.where(auth, 'assets.view', 'assignedEmployeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(scoped, { assignedEmployeeId: { [Op.ne]: null } });
    }
    if (query.status) filters.push({ status: query.status });
    if (query.category) filters.push({ category: query.category });
    if (query.employeeId) filters.push({ assignedEmployeeId: query.employeeId });
    if (query.search) {
      const like = containsPattern(query.search);
      filters.push({
        [Op.or]: [
          { tag: { [Op.iLike]: like } },
          { name: { [Op.iLike]: like } },
          { serialNumber: { [Op.iLike]: like } },
          { model: { [Op.iLike]: like } },
          { '$assignedEmployee.first_name$': { [Op.iLike]: like } },
          { '$assignedEmployee.last_name$': { [Op.iLike]: like } },
          { '$assignedEmployee.employee_code$': { [Op.iLike]: like } },
        ],
      });
    }
    const { rows, count } = await Asset.findAndCountAll({
      where: { [Op.and]: filters },
      include: [
        { model: Employee, as: 'assignedEmployee', attributes: EMPLOYEE_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: Location, attributes: ['id', 'name'] },
      ],
      order: [['tag', 'ASC']],
      distinct: true,
      subQuery: false,
      ...paginationArgs(query),
    });
    return new PaginatedResult(
      rows.map((a) => this.present(a)),
      paginationMeta(query, count),
    );
  }

  /** Counts by status for the register header. */
  async summary(auth: AuthContext) {
    if (!auth.permissions.has('assets.manage')) throw AppError.forbidden();
    const rows = (await Asset.findAll({ attributes: ['status', [literal('COUNT(*)::int'), 'count']], group: ['status'], raw: true })) as unknown as { status: string; count: number }[];
    const by = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const pendingRequests = await AssetRequest.count({ where: { status: 'PENDING' } });
    return {
      total: rows.reduce((s, r) => s + r.count, 0),
      inStock: by.IN_STOCK ?? 0,
      assigned: by.ASSIGNED ?? 0,
      inRepair: by.IN_REPAIR ?? 0,
      retired: (by.RETIRED ?? 0) + (by.LOST ?? 0),
      pendingRequests,
    };
  }

  async get(auth: AuthContext, id: string) {
    const asset = await this.visible(auth, id);
    const assignments = await AssetAssignment.findAll({
      where: { assetId: asset.id },
      include: [{ model: Employee, attributes: EMPLOYEE_ATTRS }],
      order: [['assignedAt', 'DESC']],
    });
    const names = await userNames(assignments.flatMap((a) => [a.assignedById, a.returnedById]));
    return {
      ...this.present(asset),
      permissions: { manage: auth.permissions.has('assets.manage') },
      history: assignments.map((a) => ({
        id: a.id,
        employee: person(a.employee),
        assignedAt: a.assignedAt,
        assignedBy: a.assignedById ? (names.get(a.assignedById) ?? 'Former user') : null,
        conditionOut: a.conditionOut,
        acknowledgedAt: a.acknowledgedAt,
        returnedAt: a.returnedAt,
        returnedBy: a.returnedById ? (names.get(a.returnedById) ?? 'Former user') : null,
        conditionIn: a.conditionIn,
        note: a.note,
      })),
    };
  }

  async create(auth: AuthContext, dto: AssetDto) {
    const id = await this.write(async (transaction) => {
      const tag =
        dto.tag?.toUpperCase() ??
        (await allocateReference(this.db.sequelize, transaction, auth.organizationId!, 'AST', async () =>
          (await Asset.findAll({ where: { tag: { [Op.like]: 'AST-%' } }, attributes: ['tag'], raw: true, transaction })).map((r) => r.tag),
        ));
      const asset = await Asset.create(
        {
          organizationId: auth.organizationId!,
          tag,
          name: dto.name,
          category: dto.category,
          serialNumber: dto.serialNumber ?? null,
          model: dto.model ?? null,
          purchaseDate: dto.purchaseDate ?? null,
          purchaseCost: dto.purchaseCost == null ? null : String(dto.purchaseCost),
          warrantyUntil: dto.warrantyUntil ?? null,
          condition: dto.condition ?? 'NEW',
          locationId: dto.locationId ?? null,
          notes: dto.notes ?? null,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record({ action: 'assets.created', entityType: 'Asset', entityId: asset.id, summary: `Asset ${asset.tag} (${asset.name}) added` }, transaction);
      return asset.id;
    });
    return this.get(auth, id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateAssetDto) {
    await this.write(async (transaction) => {
      const asset = await this.lock(id, transaction);
      const changes = Object.fromEntries(Object.entries({ ...dto, tag: dto.tag?.toUpperCase() }).filter(([, v]) => v !== undefined));
      if ('purchaseCost' in changes) changes.purchaseCost = changes.purchaseCost == null ? null : String(changes.purchaseCost);
      if (changes.tag === null) delete changes.tag;
      await asset.update({ ...changes, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'assets.updated', entityType: 'Asset', entityId: id, summary: `Asset ${asset.tag} updated` }, transaction);
    });
    return this.get(auth, id);
  }

  async assign(auth: AuthContext, id: string, dto: AssignAssetDto) {
    await this.write(async (transaction) => {
      const asset = await this.lock(id, transaction);
      await this.handOver(auth, asset, dto.employeeId, dto.condition ?? asset.condition, dto.note ?? null, transaction);
    });
    return this.get(auth, id);
  }

  async returnAsset(auth: AuthContext, id: string, dto: ReturnAssetDto) {
    await this.write(async (transaction) => {
      const asset = await this.lock(id, transaction);
      if (asset.status !== 'ASSIGNED') throw AppError.conflict(`${asset.tag} isn't assigned to anyone`);
      const holder = asset.assignedEmployeeId!;
      await this.closeAssignment(auth, asset, dto.condition, dto.note ?? null, transaction);
      await asset.update(
        { status: dto.condition === 'DAMAGED' ? 'IN_REPAIR' : 'IN_STOCK', condition: dto.condition, assignedEmployeeId: null, assignedAt: null, updatedById: auth.userId },
        { transaction },
      );
      await this.audit.record({ action: 'assets.returned', entityType: 'Asset', entityId: id, summary: `Asset ${asset.tag} returned in ${dto.condition.toLowerCase()} condition` }, transaction);
      await this.tell(asset.organizationId, holder, `${asset.name} (${asset.tag}) has been taken back`, `Recorded in ${dto.condition.toLowerCase()} condition.`, transaction);
    });
    return this.get(auth, id);
  }

  /** In stock, in repair, retired or lost. An assigned asset must be returned first — unless it was lost. */
  async setStatus(auth: AuthContext, id: string, dto: AssetStatusDto) {
    await this.write(async (transaction) => {
      const asset = await this.lock(id, transaction);
      if (asset.status === dto.status) return;
      if (asset.status === 'ASSIGNED') {
        if (dto.status !== 'LOST') throw AppError.conflict(`${asset.tag} is with someone. Take it back first.`);
        await this.closeAssignment(auth, asset, 'DAMAGED', dto.note ?? 'Reported lost', transaction);
      }
      await asset.update({ status: dto.status, assignedEmployeeId: null, assignedAt: null, updatedById: auth.userId }, { transaction });
      await this.audit.record(
        { action: 'assets.status_changed', entityType: 'Asset', entityId: id, summary: `Asset ${asset.tag} marked ${dto.status.replace('_', ' ').toLowerCase()}${dto.note ? `: ${dto.note}` : ''}` },
        transaction,
      );
    });
    return this.get(auth, id);
  }

  // ---- Employee ---------------------------------------------------------------------------------

  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { assets: [], requests: [], canRequest: false };
    const [assets, requests] = await Promise.all([
      Asset.findAll({ where: { assignedEmployeeId: self.id }, include: [{ model: AssetAssignment, where: { returnedAt: null }, required: false }], order: [['assignedAt', 'DESC']] }),
      AssetRequest.findAll({ where: { employeeId: self.id }, include: [{ model: Asset, attributes: ['id', 'tag', 'name'] }], order: [['createdAt', 'DESC']], limit: 20 }),
    ]);
    return {
      assets: assets.map((a) => {
        const open = a.assignments?.[0];
        return { ...this.present(a), assignmentId: open?.id ?? null, acknowledgedAt: open?.acknowledgedAt ?? null, conditionOut: open?.conditionOut ?? null };
      }),
      requests: requests.map((r) => this.presentRequest(r, self.id)),
      canRequest: self.status !== 'EXITED' && auth.permissions.has('assets.request'),
    };
  }

  /** The employee confirms they received the asset. */
  async acknowledge(auth: AuthContext, assignmentId: string) {
    const self = await this.scope.self(auth);
    await this.db.transaction(async (transaction) => {
      const a = await AssetAssignment.findByPk(assignmentId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!a || !self || a.employeeId !== self.id || a.returnedAt) throw AppError.notFound('Assignment');
      if (a.acknowledgedAt) return;
      await a.update({ acknowledgedAt: new Date() }, { transaction });
      const asset = await Asset.findByPk(a.assetId, { attributes: ['tag'], transaction });
      await this.audit.record({ action: 'assets.acknowledged', entityType: 'Asset', entityId: a.assetId, summary: `Receipt of ${asset?.tag} confirmed by ${self.employeeCode}` }, transaction);
    });
    return this.mine(auth);
  }

  // ---- Requests ---------------------------------------------------------------------------------

  async requestAsset(auth: AuthContext, dto: AssetRequestDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can request assets');
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    await this.db.transaction(async (transaction) => {
      if (await AssetRequest.count({ where: { employeeId: self.id, category: dto.category, status: 'PENDING' }, transaction }))
        throw AppError.conflict(`You already have a pending request for a ${ASSET_CATEGORY_LABELS[dto.category].toLowerCase()}`);
      const r = await AssetRequest.create({ organizationId: auth.organizationId!, employeeId: self.id, category: dto.category, reason: dto.reason, requestedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'assets.requested', entityType: 'AssetRequest', entityId: r.id, summary: `${ASSET_CATEGORY_LABELS[dto.category]} requested by ${self.employeeCode}` }, transaction);
      for (const userId of await usersWithPermission('assets.manage', transaction)) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(
          userId,
          { organizationId: auth.organizationId, type: 'assets.request', title: `${fullName(self)} asked for a ${ASSET_CATEGORY_LABELS[dto.category].toLowerCase()}`, body: dto.reason, link: '/hr/assets?tab=requests' },
          transaction,
        );
      }
    });
    return this.mine(auth);
  }

  async requests(auth: AuthContext, query: AssetRequestQueryDto) {
    const self = await this.scope.self(auth);
    const filters: WhereOptions[] = [];
    if ((query.view ?? 'mine') === 'all') {
      if (!auth.permissions.has('assets.manage')) throw AppError.forbidden();
    } else {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    }
    if (query.status) filters.push({ status: query.status });
    const { rows, count } = await AssetRequest.findAndCountAll({
      where: { [Op.and]: filters },
      include: [
        { model: Employee, attributes: EMPLOYEE_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: Asset, attributes: ['id', 'tag', 'name'] },
      ],
      order: [
        [literal(`CASE WHEN "AssetRequest"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'],
        ['createdAt', 'DESC'],
      ],
      ...paginationArgs(query),
    });
    const names = await userNames(rows.map((r) => r.reviewedById));
    return new PaginatedResult(
      rows.map((r) => ({ ...this.presentRequest(r, self?.id ?? null), reviewedBy: r.reviewedById ? (names.get(r.reviewedById) ?? 'Former user') : null })),
      paginationMeta(query, count),
    );
  }

  /** Hands an in-stock asset to the requester and closes the request. */
  async fulfil(auth: AuthContext, id: string, dto: FulfilAssetRequestDto) {
    await this.write(async (transaction) => {
      const r = await this.pendingRequest(id, transaction);
      const asset = await this.lock(dto.assetId, transaction);
      await this.handOver(auth, asset, r.employeeId, asset.condition, dto.note ?? null, transaction);
      await r.update({ status: 'FULFILLED', assetId: asset.id, reviewNote: dto.note ?? null, reviewedById: auth.userId, reviewedAt: new Date() }, { transaction });
    });
    return { id, status: 'FULFILLED' as const };
  }

  async reject(auth: AuthContext, id: string, dto: NoteDto) {
    await this.write(async (transaction) => {
      const r = await this.pendingRequest(id, transaction);
      await r.update({ status: 'REJECTED', reviewNote: dto.note, reviewedById: auth.userId, reviewedAt: new Date() }, { transaction });
      await this.audit.record({ action: 'assets.request_rejected', entityType: 'AssetRequest', entityId: id, summary: `${ASSET_CATEGORY_LABELS[r.category]} request rejected` }, transaction);
      await this.tell(r.organizationId, r.employeeId, `Your request for a ${ASSET_CATEGORY_LABELS[r.category].toLowerCase()} was not approved`, dto.note, transaction);
    });
    return { id, status: 'REJECTED' as const };
  }

  async cancelRequest(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    await this.db.transaction(async (transaction) => {
      const r = await AssetRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r || !self || r.employeeId !== self.id) throw AppError.notFound('Request');
      if (r.status !== 'PENDING') throw AppError.conflict(`This request is already ${r.status.toLowerCase()}`);
      await r.update({ status: 'CANCELLED' }, { transaction });
    });
    return this.mine(auth);
  }

  // ---- Internals --------------------------------------------------------------------------------

  private async handOver(auth: AuthContext, asset: Asset, employeeId: string, condition: AssetCondition, note: string | null, transaction: Transaction) {
    if (asset.status !== 'IN_STOCK') throw AppError.conflict(asset.status === 'ASSIGNED' ? `${asset.tag} is already with someone` : `${asset.tag} is ${asset.status.replace('_', ' ').toLowerCase()}`);
    const employee = await Employee.findByPk(employeeId, { attributes: EMPLOYEE_ATTRS, transaction });
    if (!employee) throw AppError.notFound('Employee');
    if (employee.status === 'EXITED') throw AppError.conflict(`${fullName(employee)} has exited`);
    const now = new Date();
    await AssetAssignment.create(
      { organizationId: asset.organizationId, assetId: asset.id, employeeId, assignedAt: now, assignedById: auth.userId, conditionOut: condition, note },
      { transaction },
    );
    await asset.update({ status: 'ASSIGNED', condition, assignedEmployeeId: employeeId, assignedAt: now, updatedById: auth.userId }, { transaction });
    await this.audit.record({ action: 'assets.assigned', entityType: 'Asset', entityId: asset.id, summary: `Asset ${asset.tag} assigned to ${employee.employeeCode}` }, transaction);
    await this.tell(asset.organizationId, employeeId, `${asset.name} (${asset.tag}) has been assigned to you`, 'Confirm you received it under My assets.', transaction);
  }

  private async closeAssignment(auth: AuthContext, asset: Asset, condition: AssetCondition, note: string | null, transaction: Transaction) {
    const open = await AssetAssignment.findOne({ where: { assetId: asset.id, returnedAt: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (open) await open.update({ returnedAt: new Date(), returnedById: auth.userId, conditionIn: condition, note: note ?? open.note }, { transaction });
  }

  private async visible(auth: AuthContext, id: string) {
    const asset = await Asset.findByPk(id, {
      include: [
        { model: Employee, as: 'assignedEmployee', attributes: EMPLOYEE_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: Location, attributes: ['id', 'name'] },
      ],
    });
    if (!asset) throw AppError.notFound('Asset');
    if (auth.permissions.has('assets.manage')) return asset;
    if (asset.assignedEmployee && (await this.scope.covers(auth, 'assets.view', asset.assignedEmployee))) return asset;
    throw AppError.notFound('Asset');
  }

  private async lock(id: string, transaction: Transaction) {
    const asset = await Asset.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!asset) throw AppError.notFound('Asset');
    return asset;
  }

  private async pendingRequest(id: string, transaction: Transaction) {
    const r = await AssetRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!r) throw AppError.notFound('Request');
    if (r.status !== 'PENDING') throw AppError.conflict(`This request is already ${r.status.toLowerCase()}`);
    return r;
  }

  private write<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(fn).catch((e: unknown) => {
      if (e instanceof UniqueConstraintError) {
        const field = Object.keys(e.fields ?? {}).find((f) => f.includes('serial')) ? 'serialNumber' : 'tag';
        throw AppError.validation([{ field, message: field === 'tag' ? 'Another asset already has this tag' : 'Another asset already has this serial number' }]);
      }
      throw e;
    });
  }

  private async tell(organizationId: string, employeeId: string, title: string, body: string | undefined, transaction: Transaction) {
    const userId = (await userIdsOf([employeeId], transaction)).get(employeeId);
    if (userId) await this.notifications.notify(userId, { organizationId, type: 'assets.assignment', title, body, link: '/me/assets' }, transaction);
  }

  private present(a: Asset) {
    return {
      id: a.id,
      tag: a.tag,
      name: a.name,
      category: a.category,
      serialNumber: a.serialNumber,
      model: a.model,
      purchaseDate: a.purchaseDate,
      purchaseCost: a.purchaseCost === null ? null : Number(a.purchaseCost),
      warrantyUntil: a.warrantyUntil,
      status: a.status,
      condition: a.condition,
      location: a.location ? { id: a.location.id, name: a.location.name } : null,
      notes: a.notes,
      assignedTo: person(a.assignedEmployee),
      assignedAt: a.assignedAt,
    };
  }

  private presentRequest(r: AssetRequest, selfId: string | null) {
    return {
      id: r.id,
      category: r.category,
      reason: r.reason,
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
      employee: person(r.employee),
      asset: r.asset ? { id: r.asset.id, tag: r.asset.tag, name: r.asset.name } : null,
      permissions: { cancel: r.employeeId === selfId && r.status === 'PENDING' },
    };
  }
}
