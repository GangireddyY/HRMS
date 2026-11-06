import { Injectable } from '@nestjs/common';
import { Op, type FindOptions, type Order, type WhereOptions } from 'sequelize';
import { paginationArgs, paginationMeta, resolveSort } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { AuditLog, LoginEvent, User } from '../../database/models';
import { AuditLogQueryDto, LoginEventQueryDto, dateRange } from './dto/audit-query.dto';

/** Columns + actor returned by audit-log listings. */
export const AUDIT_QUERY: FindOptions<AuditLog> = {
  attributes: ['id', 'action', 'entityType', 'entityId', 'summary', 'changes', 'metadata', 'ipAddress', 'requestId', 'createdAt'],
  include: [{ model: User, as: 'actor', attributes: ['id', 'email', 'firstName', 'lastName'] }],
};

export const AUDIT_SORT: Record<string, (d: 'asc' | 'desc') => Order> = {
  createdAt: (d) => [['createdAt', d]],
  action: (d) => [['action', d]],
};

export function auditWhere(q: AuditLogQueryDto): WhereOptions<AuditLog> {
  const range = dateRange(q.from, q.to);
  return {
    ...(q.action ? { action: { [Op.startsWith]: q.action } } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    ...(q.search ? { [Op.or]: [{ summary: { [Op.iLike]: containsPattern(q.search) } }, { action: { [Op.iLike]: containsPattern(q.search) } }] } : {}),
    ...(range ? { createdAt: range } : {}),
  };
}

/** Organization-scoped audit trail and login history (tenant models, scoped automatically). */
@Injectable()
export class AuditLogsService {
  async list(q: AuditLogQueryDto) {
    const { rows, count } = await AuditLog.findAndCountAll({
      ...AUDIT_QUERY,
      where: auditWhere(q),
      order: resolveSort(q.sort, AUDIT_SORT, [['createdAt', 'DESC']]),
      ...paginationArgs(q),
    });
    return new PaginatedResult(rows, paginationMeta(q, count));
  }

  async loginEvents(q: LoginEventQueryDto) {
    const range = dateRange(q.from, q.to);
    const { rows, count } = await LoginEvent.findAndCountAll({
      where: {
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(range ? { createdAt: range } : {}),
        ...(q.search ? { email: { [Op.iLike]: containsPattern(q.search) } } : {}),
      },
      order: [['createdAt', 'DESC']],
      ...paginationArgs(q),
      attributes: ['id', 'email', 'outcome', 'failureReason', 'ipAddress', 'userAgent', 'createdAt'],
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
    });
    return new PaginatedResult(rows, paginationMeta(q, count));
  }
}
