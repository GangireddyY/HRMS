import { Injectable } from '@nestjs/common';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import { RECOMMENDED_ONBOARDING_TASKS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { OnboardingTemplate, OnboardingTemplateTask } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { TemplateDto, TemplateTaskDto, UpdateTemplateDto } from './dto/onboarding.dto';

export function presentTemplate(t: OnboardingTemplate) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.isDefault,
    isActive: t.isActive,
    tasks: [...(t.tasks ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((k) => ({ id: k.id, title: k.title, description: k.description, assignee: k.assignee, documentCategory: k.documentCategory, dueOffsetDays: k.dueOffsetDays, isRequired: k.isRequired })),
    updatedAt: t.updatedAt,
  };
}

/** Reusable onboarding checklists. */
@Injectable()
export class OnboardingTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await OnboardingTemplate.findAll({ include: [{ model: OnboardingTemplateTask }], order: [['isDefault', 'DESC'], ['name', 'ASC']] });
    return rows.map(presentTemplate);
  }

  async get(id: string) {
    return presentTemplate(await this.find(id));
  }

  async create(auth: AuthContext, dto: TemplateDto) {
    this.validateTasks(dto.tasks);
    const id = await this.guard(() =>
      this.db.transaction(async (transaction) => {
        if (dto.isDefault) await this.clearDefault(transaction);
        const row = await OnboardingTemplate.create(
          { organizationId: auth.organizationId!, name: dto.name, description: dto.description ?? null, isDefault: !!dto.isDefault, isActive: dto.isActive ?? true, createdById: auth.userId, updatedById: auth.userId },
          { transaction },
        );
        await this.writeTasks(auth, row.id, dto.tasks, transaction);
        await this.audit.record({ action: 'onboarding_template.created', entityType: 'OnboardingTemplate', entityId: row.id, summary: `Checklist "${row.name}" created (${dto.tasks.length} tasks)` }, transaction);
        return row.id;
      }),
    );
    return this.get(id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateTemplateDto) {
    const row = await this.find(id);
    if (dto.tasks) this.validateTasks(dto.tasks);
    await this.guard(() =>
      this.db.transaction(async (transaction) => {
        if (dto.isDefault && !row.isDefault) await this.clearDefault(transaction);
        await row.update(
          {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            updatedById: auth.userId,
          },
          { transaction },
        );
        if (dto.tasks) {
          await OnboardingTemplateTask.destroy({ where: { templateId: id }, transaction });
          await this.writeTasks(auth, id, dto.tasks, transaction);
        }
        await this.audit.record({ action: 'onboarding_template.updated', entityType: 'OnboardingTemplate', entityId: id, summary: `Checklist "${row.name}" updated` }, transaction);
      }),
    );
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const row = await this.find(id);
    await this.db.transaction(async (transaction) => {
      await row.destroy({ transaction });
      await this.audit.record({ action: 'onboarding_template.deleted', entityType: 'OnboardingTemplate', entityId: id, summary: `Checklist "${row.name}" deleted` }, transaction);
    });
  }

  /** Creates the recommended standard checklist (as the default) unless one with that name exists. */
  async addRecommended(auth: AuthContext) {
    const name = 'Standard onboarding';
    const existing = await OnboardingTemplate.findOne({ where: { name } });
    if (existing) return this.get(existing.id);
    const hasDefault = (await OnboardingTemplate.count({ where: { isDefault: true } })) > 0;
    return this.create(auth, {
      name,
      description: 'Pre-joining preparation, joining documents, first-week setup and the 30-day check-in.',
      isDefault: !hasDefault,
      tasks: RECOMMENDED_ONBOARDING_TASKS.map((t) => ({
        title: t.title,
        description: 'description' in t ? t.description : null,
        assignee: t.assignee,
        documentCategory: 'documentCategory' in t ? t.documentCategory : null,
        dueOffsetDays: t.dueOffsetDays,
        isRequired: 'isRequired' in t ? t.isRequired : true,
      })),
    });
  }

  /** The default active template, if any. */
  async defaultTemplate(): Promise<OnboardingTemplate | null> {
    return OnboardingTemplate.findOne({ where: { isDefault: true, isActive: true }, include: [{ model: OnboardingTemplateTask }] });
  }

  async find(id: string): Promise<OnboardingTemplate> {
    const row = await OnboardingTemplate.findByPk(id, { include: [{ model: OnboardingTemplateTask }] });
    if (!row) throw AppError.notFound('Checklist template');
    return row;
  }

  private validateTasks(tasks: TemplateTaskDto[]) {
    const issues = tasks.flatMap((t, i) => (t.documentCategory && t.assignee !== 'EMPLOYEE' ? [{ field: `tasks.${i}.assignee`, message: 'Document tasks are completed by the employee' }] : []));
    if (issues.length) throw AppError.validation(issues);
  }

  private async writeTasks(auth: AuthContext, templateId: string, tasks: TemplateTaskDto[], transaction: Transaction) {
    if (!tasks.length) return;
    await OnboardingTemplateTask.bulkCreate(
      tasks.map((t, i) => ({
        organizationId: auth.organizationId!,
        templateId,
        title: t.title,
        description: t.description ?? null,
        assignee: t.assignee,
        documentCategory: t.documentCategory ?? null,
        dueOffsetDays: t.dueOffsetDays ?? 0,
        isRequired: t.isRequired ?? true,
        sortOrder: i,
      })),
      { transaction },
    );
  }

  private async clearDefault(transaction: Transaction) {
    await OnboardingTemplate.update({ isDefault: false }, { where: { isDefault: true }, transaction });
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'name', message: 'A checklist with this name already exists' }]);
      throw e;
    }
  }
}
