import { Injectable } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { PaginationQueryDto, paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { Notification } from '../../database/models';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Null/undefined = personal notification visible in every organization. */
  organizationId?: string | null;
}

const PUBLIC_ATTRIBUTES = ['id', 'type', 'title', 'body', 'link', 'readAt', 'createdAt'];

/**
 * In-app notifications. Visible to a user when personal (no organization) or belonging to the
 * user's active organization.
 */
@Injectable()
export class NotificationsService {
  async notify(userId: string, input: NotificationInput, transaction?: Transaction): Promise<void> {
    await Notification.create(
      {
        userId,
        organizationId: input.organizationId ?? null,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body ?? null,
        link: input.link ?? null,
      },
      { transaction },
    );
  }

  private visibleTo(userId: string, organizationId: string | null): WhereOptions<Notification> {
    return {
      userId,
      [Op.or]: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])],
    };
  }

  async list(userId: string, organizationId: string | null, query: PaginationQueryDto & { unreadOnly?: boolean }) {
    const where: WhereOptions<Notification> = {
      [Op.and]: [this.visibleTo(userId, organizationId), ...(query.unreadOnly ? [{ readAt: null }] : [])],
    };
    const { offset, limit } = paginationArgs(query);
    const { rows, count } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      offset,
      limit,
      attributes: PUBLIC_ATTRIBUTES,
    });
    return new PaginatedResult(rows, paginationMeta(query, count));
  }

  unreadCount(userId: string, organizationId: string | null): Promise<number> {
    return Notification.count({ where: { [Op.and]: [this.visibleTo(userId, organizationId), { readAt: null }] } });
  }

  async markRead(userId: string, organizationId: string | null, id: string): Promise<void> {
    const [count] = await Notification.update({ readAt: new Date() }, { where: { [Op.and]: [{ id }, this.visibleTo(userId, organizationId)] } });
    if (count === 0) throw AppError.notFound('Notification');
  }

  async markAllRead(userId: string, organizationId: string | null): Promise<number> {
    const [count] = await Notification.update({ readAt: new Date() }, { where: { [Op.and]: [this.visibleTo(userId, organizationId), { readAt: null }] } });
    return count;
  }
}
