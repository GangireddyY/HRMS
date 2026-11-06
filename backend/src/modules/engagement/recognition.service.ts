import { Injectable } from '@nestjs/common';
import { col, fn, Op, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, Recognition, RecognitionRecipient, Suggestion, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { fullName, personRef, userIdsOf } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import type { RecognitionDto, RecognitionQueryDto, ReviewSuggestionDto, SuggestionDto, SuggestionQueryDto } from './dto/engagement.dto';

const PERSON = ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId', 'designationId'];
const EDIT_WINDOW_MS = 24 * 3_600_000;

/** Recognition wall (`engagement.recognition.give`) and suggestions box (reviewed with `engagement.survey.manage`). */
@Injectable()
export class RecognitionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Recognition -----------------------------------------------------------------------------

  async feed(auth: AuthContext, query: RecognitionQueryDto) {
    const where: WhereOptions = query.employeeId ? { id: { [Op.in]: (await RecognitionRecipient.findAll({ where: { employeeId: query.employeeId }, attributes: ['recognitionId'] })).map((r) => r.recognitionId) } } : {};
    const { rows, count } = await Recognition.findAndCountAll({
      where,
      include: [
        { model: Employee, as: 'giver', attributes: PERSON, include: [{ model: Designation, attributes: ['id', 'name'] }] },
        { model: RecognitionRecipient, include: [{ model: Employee, attributes: PERSON, include: [{ model: Department, attributes: ['id', 'name'] }] }] },
      ],
      order: [['createdAt', 'DESC']],
      distinct: true,
      ...paginationArgs(query),
    });
    const self = await this.scope.self(auth);
    const moderator = auth.permissions.has('engagement.announcement.manage');
    return new PaginatedResult(
      rows.map((r) => ({
        id: r.id,
        badge: r.badge,
        message: r.message,
        createdAt: r.createdAt,
        giver: personRef(r.giver),
        recipients: (r.recipients ?? []).map((x) => ({ ...personRef(x.employee)!, department: x.employee?.department?.name ?? null })),
        canDelete: moderator || (r.giverId === self?.id && Date.now() - r.createdAt.getTime() < EDIT_WINDOW_MS),
      })),
      paginationMeta(query, count),
    );
  }

  /** Most recognised people this calendar month, plus the caller's own totals. */
  async stats(auth: AuthContext) {
    const self = await this.scope.self(auth);
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const monthIds = (await Recognition.findAll({ where: { createdAt: { [Op.gte]: start } }, attributes: ['id'] })).map((r) => r.id);
    const top = monthIds.length
      ? ((await RecognitionRecipient.findAll({ where: { recognitionId: monthIds }, attributes: ['employeeId', [fn('COUNT', col('id')), 'count']], group: ['employeeId'], order: [[fn('COUNT', col('id')), 'DESC']], limit: 5, raw: true })) as unknown as { employeeId: string; count: string }[])
      : [];
    const people = new Map((await Employee.findAll({ where: { id: top.map((t) => t.employeeId) }, attributes: PERSON })).map((e) => [e.id, e]));
    return {
      thisMonth: monthIds.length,
      topRecipients: top.filter((t) => people.has(t.employeeId)).map((t) => ({ employee: personRef(people.get(t.employeeId))!, count: Number(t.count) })),
      mine: self
        ? { received: await RecognitionRecipient.count({ where: { employeeId: self.id } }), given: await Recognition.count({ where: { giverId: self.id } }) }
        : null,
    };
  }

  async give(auth: AuthContext, dto: RecognitionDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can recognise colleagues');
    if (dto.recipientIds.includes(self.id)) throw AppError.validation([{ field: 'recipientIds', message: "You can't recognise yourself" }]);
    const recipients = await Employee.findAll({ where: { id: dto.recipientIds, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: PERSON });
    if (recipients.length !== dto.recipientIds.length) throw AppError.validation([{ field: 'recipientIds', message: 'Choose active colleagues' }]);
    const r = await this.db.transaction(async (transaction) => {
      const created = await Recognition.create({ organizationId: auth.organizationId!, giverId: self.id, badge: dto.badge, message: dto.message }, { transaction });
      await RecognitionRecipient.bulkCreate(recipients.map((e) => ({ organizationId: auth.organizationId!, recognitionId: created.id, employeeId: e.id })), { transaction });
      const users = await userIdsOf(recipients.map((e) => e.id), transaction);
      for (const userId of users.values()) {
        await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'engagement.recognition', title: `${fullName(self)} recognised you`, body: dto.message.slice(0, 140), link: '/me/engagement' }, transaction);
      }
      await this.audit.record({ action: 'engagement.recognition_given', entityType: 'Recognition', entityId: created.id, summary: `${self.employeeCode} recognised ${recipients.map((e) => e.employeeCode).join(', ')} (${dto.badge.toLowerCase()})` }, transaction);
      return created;
    });
    return (await this.feed(auth, { page: 1, pageSize: 1 } as RecognitionQueryDto)).items.find((x) => x.id === r.id) ?? { id: r.id };
  }

  /** The giver within 24 hours, or a moderator (`engagement.announcement.manage`) any time. */
  async remove(auth: AuthContext, id: string) {
    const r = await Recognition.findByPk(id);
    if (!r) throw AppError.notFound('Recognition');
    const self = await this.scope.self(auth);
    const moderator = auth.permissions.has('engagement.announcement.manage');
    if (!moderator && !(r.giverId === self?.id && Date.now() - r.createdAt.getTime() < EDIT_WINDOW_MS)) throw AppError.forbidden('Recognition can be removed by its author within a day, or by a moderator');
    await this.db.transaction(async (transaction) => {
      await r.destroy({ transaction });
      await this.audit.record({ action: 'engagement.recognition_removed', entityType: 'Recognition', entityId: id, summary: moderator && r.giverId !== self?.id ? 'Recognition removed by a moderator' : 'Recognition removed by its author' }, transaction);
    });
  }

  /** Active colleagues to recognise: names and roles only. */
  async colleagues(auth: AuthContext, search?: string) {
    const self = await this.scope.self(auth);
    const like = search ? containsPattern(search) : null;
    const rows = await Employee.findAll({
      where: {
        status: ['ACTIVE', 'ON_NOTICE'],
        ...(self ? { id: { [Op.ne]: self.id } } : {}),
        ...(like ? { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] } : {}),
      },
      attributes: PERSON,
      include: [{ model: Department, attributes: ['id', 'name'] }, { model: Designation, attributes: ['id', 'name'] }],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
      limit: 20,
    });
    return rows.map((e) => ({ ...personRef(e)!, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
  }

  // ---- Suggestions -----------------------------------------------------------------------------

  async suggest(auth: AuthContext, dto: SuggestionDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can send suggestions');
    const s = await this.db.transaction(async (transaction) => {
      const created = await Suggestion.create({ organizationId: auth.organizationId!, employeeId: dto.anonymous ? null : self.id, title: dto.title, body: dto.body, category: dto.category }, { transaction });
      // Not audited when anonymous: audit entries carry the actor and IP address.
      if (!dto.anonymous) await this.audit.record({ action: 'engagement.suggestion_submitted', entityType: 'Suggestion', entityId: created.id, summary: `Suggestion "${dto.title}" submitted` }, transaction);
      return created;
    });
    return this.presentSuggestion(s, dto.anonymous ? null : self, new Map());
  }

  async suggestions(auth: AuthContext, query: SuggestionQueryDto) {
    const view = query.view ?? 'mine';
    const conditions: WhereOptions[] = [];
    if (view === 'mine') {
      const self = await this.scope.self(auth);
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push({ employeeId: self.id });
    } else if (!auth.permissions.has('engagement.survey.manage')) {
      throw AppError.forbidden();
    }
    if (query.status) conditions.push({ status: query.status });
    const { rows, count } = await Suggestion.findAndCountAll({ where: { [Op.and]: conditions }, include: [{ model: Employee, attributes: PERSON }], order: [['createdAt', 'DESC']], ...paginationArgs(query) });
    const responders = await this.userNames(rows.map((r) => r.respondedById));
    return new PaginatedResult(rows.map((s) => this.presentSuggestion(s, s.employee ?? null, responders)), paginationMeta(query, count));
  }

  async review(auth: AuthContext, id: string, dto: ReviewSuggestionDto) {
    const s = await Suggestion.findByPk(id, { include: [{ model: Employee, attributes: PERSON }] });
    if (!s) throw AppError.notFound('Suggestion');
    await this.db.transaction(async (transaction) => {
      await s.update({ status: dto.status, response: dto.response ?? s.response, respondedById: auth.userId, respondedAt: new Date() }, { transaction });
      await this.audit.record({ action: 'engagement.suggestion_reviewed', entityType: 'Suggestion', entityId: id, summary: `Suggestion "${s.title}" marked ${dto.status.toLowerCase().replace('_', ' ')}` }, transaction);
      if (s.employeeId) {
        const userId = (await userIdsOf([s.employeeId], transaction)).get(s.employeeId);
        if (userId && userId !== auth.userId) {
          await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'engagement.suggestion', title: `Your suggestion "${s.title}" was updated`, body: dto.response ?? undefined, link: '/me/engagement/suggestions' }, transaction);
        }
      }
    });
    return this.presentSuggestion(s, s.employee ?? null, await this.userNames([s.respondedById]));
  }

  private presentSuggestion(s: Suggestion, author: Employee | null, responders: Map<string, string>) {
    return {
      id: s.id,
      title: s.title,
      body: s.body,
      category: s.category,
      status: s.status,
      anonymous: !s.employeeId,
      author: personRef(author),
      response: s.response,
      respondedBy: s.respondedById ? (responders.get(s.respondedById) ?? null) : null,
      respondedAt: s.respondedAt,
      createdAt: s.createdAt,
    };
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
