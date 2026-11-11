import { Injectable } from '@nestjs/common';
import { isEmail, isISO8601, isURL } from 'class-validator';
import { CUSTOM_FIELD_MAX_PER_ENTITY, type CustomFieldValue } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { CustomFieldDefinition, Employee } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { CustomFieldDefinitionDto, UpdateCustomFieldDefinitionDto } from './dto/custom-fields.dto';
import { EmployeeScopeService } from './employee-scope.service';

const EMPLOYEE_ATTRS = ['id', 'managerId', 'departmentId', 'membershipId', 'employeeCode', 'customFields'];
const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** A value checked against its field's type; null clears it. */
export function coerceValue(def: Pick<CustomFieldDefinition, 'type' | 'options' | 'label'>, raw: unknown): CustomFieldValue {
  if (empty(raw)) return null;
  const bad = (why: string): never => {
    throw AppError.validation([{ field: def.label, message: `${def.label}: ${why}` }]);
  };
  switch (def.type) {
    case 'TEXT':
    case 'LONG_TEXT': {
      if (typeof raw !== 'string') bad('enter text');
      const s = (raw as string).trim();
      if (s.length > (def.type === 'TEXT' ? 500 : 4000)) bad('too long');
      return s;
    }
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) bad('enter a number');
      return n;
    }
    case 'DATE':
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || !isISO8601(raw, { strict: true })) bad('enter a date (YYYY-MM-DD)');
      return raw as string;
    case 'BOOLEAN':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'yes') return true;
      if (raw === 'false' || raw === 'no') return false;
      return bad('choose yes or no');
    case 'SELECT':
      if (typeof raw !== 'string' || !def.options.includes(raw)) bad(`choose one of ${def.options.join(', ')}`);
      return raw as string;
    case 'MULTI_SELECT': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s*[;|]\s*/) : bad('choose options');
      const values = [...new Set((list as unknown[]).map(String).filter(Boolean))];
      const unknown = values.filter((v) => !def.options.includes(v));
      if (unknown.length) bad(`not an option: ${unknown.join(', ')}`);
      return values;
    }
    case 'EMAIL':
      if (typeof raw !== 'string' || !isEmail(raw.trim())) bad('enter an email address');
      return (raw as string).trim().toLowerCase();
    case 'URL':
      if (typeof raw !== 'string' || !isURL(raw.trim(), { require_protocol: true, protocols: ['http', 'https'] })) bad('enter a web address starting with https://');
      return (raw as string).trim();
  }
}

/**
 * Custom employee fields. Definitions (`employee.fields.manage`) are typed, optionally required, sensitive (seen only
 * with `employee.sensitive.view` and by the employee) or editable by the employee. Values are read with the employee
 * and changed with `employee.update` covering them — or by the employee for the fields they may edit.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
  ) {}

  async definitions(includeArchived = false) {
    const rows = await CustomFieldDefinition.findAll({ where: { entity: 'EMPLOYEE', ...(includeArchived ? {} : { archivedAt: null }) }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] });
    return rows.map((d) => this.presentDefinition(d));
  }

  async create(auth: AuthContext, dto: CustomFieldDefinitionDto) {
    this.checkOptions(dto.type, dto.options);
    if ((await CustomFieldDefinition.count({ where: { entity: 'EMPLOYEE' } })) >= CUSTOM_FIELD_MAX_PER_ENTITY) throw AppError.conflict(`Up to ${CUSTOM_FIELD_MAX_PER_ENTITY} custom fields can be defined`);
    if (await CustomFieldDefinition.count({ where: { entity: 'EMPLOYEE', key: dto.key } })) throw AppError.validation([{ field: 'key', message: 'Another field already uses this key' }]);
    const last = await CustomFieldDefinition.max<number, CustomFieldDefinition>('sortOrder', { where: { entity: 'EMPLOYEE' } });
    const d = await this.db.transaction(async (transaction) => {
      const created = await CustomFieldDefinition.create(
        {
          organizationId: auth.organizationId!,
          key: dto.key,
          label: dto.label,
          type: dto.type,
          options: dto.options ?? [],
          required: dto.required ?? false,
          sensitive: dto.sensitive ?? false,
          employeeEditable: dto.employeeEditable ?? false,
          section: dto.section ?? null,
          helpText: dto.helpText ?? null,
          sortOrder: (last ?? 0) + 1,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record({ action: 'employee.custom_field_created', entityType: 'CustomFieldDefinition', entityId: created.id, summary: `Custom field "${dto.label}" (${dto.type.toLowerCase()}) added` }, transaction);
      return created;
    });
    return this.presentDefinition(d);
  }

  async update(auth: AuthContext, id: string, dto: UpdateCustomFieldDefinitionDto) {
    const d = await this.find(id);
    if (dto.options) this.checkOptions(d.type, dto.options);
    await this.db.transaction(async (transaction) => {
      await d.update(
        {
          ...(dto.label ? { label: dto.label } : {}),
          ...(dto.options ? { options: dto.options } : {}),
          ...(dto.required !== undefined ? { required: dto.required } : {}),
          ...(dto.sensitive !== undefined ? { sensitive: dto.sensitive } : {}),
          ...(dto.employeeEditable !== undefined ? { employeeEditable: dto.employeeEditable } : {}),
          ...(dto.section !== undefined ? { section: dto.section } : {}),
          ...(dto.helpText !== undefined ? { helpText: dto.helpText } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.archived !== undefined ? { archivedAt: dto.archived ? new Date() : null } : {}),
          updatedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        { action: 'employee.custom_field_updated', entityType: 'CustomFieldDefinition', entityId: id, summary: dto.archived ? `Custom field "${d.label}" archived` : `Custom field "${d.label}" updated`, metadata: { ...dto } },
        transaction,
      );
    });
    return this.presentDefinition(d);
  }

  /** The employee's fields with values, for HR (in scope) or the employee themself. */
  async values(auth: AuthContext, employeeId: string | 'me') {
    const { employee, self, canEdit, canSensitive } = await this.access(auth, employeeId);
    const defs = await CustomFieldDefinition.findAll({ where: { entity: 'EMPLOYEE', archivedAt: null }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] });
    const values = employee.customFields ?? {};
    return defs.map((d) => {
      const hidden = d.sensitive && !canSensitive && !self;
      return { ...this.presentDefinition(d), value: hidden ? null : (values[d.key] ?? null), hidden, editable: (canEdit && (!d.sensitive || canSensitive)) || (self && d.employeeEditable) };
    });
  }

  async setValues(auth: AuthContext, employeeId: string | 'me', input: Record<string, unknown>) {
    const { employee, self, canEdit, canSensitive } = await this.access(auth, employeeId);
    const defs = new Map((await CustomFieldDefinition.findAll({ where: { entity: 'EMPLOYEE', archivedAt: null } })).map((d) => [d.key, d]));
    const before = { ...(employee.customFields ?? {}) };
    const next = { ...before };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, raw] of Object.entries(input)) {
      const d = defs.get(key);
      if (!d) throw AppError.validation([{ field: key, message: `Unknown field "${key}"` }]);
      const allowed = (canEdit && (!d.sensitive || canSensitive)) || (self && d.employeeEditable);
      if (!allowed) throw AppError.forbidden(`You can't change "${d.label}"`);
      const value = coerceValue(d, raw);
      if (d.required && value === null) throw AppError.validation([{ field: key, message: `${d.label} is required` }]);
      if (JSON.stringify(before[key] ?? null) !== JSON.stringify(value)) changes[key] = d.sensitive ? { from: '[REDACTED]', to: '[REDACTED]' } : { from: before[key] ?? null, to: value };
      if (value === null) delete next[key];
      else next[key] = value;
    }
    if (Object.keys(changes).length) {
      await this.db.transaction(async (transaction) => {
        await Employee.update({ customFields: next }, { where: { id: employee.id }, transaction });
        await this.audit.record({ action: self ? 'employee.custom_fields_self_updated' : 'employee.custom_fields_updated', entityType: 'Employee', entityId: employee.id, summary: `Custom fields of ${employee.employeeCode} updated`, changes }, transaction);
      });
    }
    return this.values(auth, employeeId);
  }

  private async access(auth: AuthContext, employeeId: string | 'me') {
    const me = await this.scope.self(auth);
    const id = employeeId === 'me' ? me?.id : employeeId;
    if (!id) throw AppError.notFound('Employee record');
    const employee = await Employee.findByPk(id, { attributes: EMPLOYEE_ATTRS });
    if (!employee) throw AppError.notFound('Employee');
    const self = me?.id === employee.id;
    if (!self && !(await this.scope.covers(auth, 'employee.view', employee))) throw AppError.notFound('Employee');
    return {
      employee,
      self,
      canEdit: !self && (await this.scope.covers(auth, 'employee.update', employee)),
      canSensitive: await this.scope.covers(auth, 'employee.sensitive.view', employee),
    };
  }

  private checkOptions(type: string, options: string[] | undefined) {
    const needs = type === 'SELECT' || type === 'MULTI_SELECT';
    if (needs && (!options || options.length < 2)) throw AppError.validation([{ field: 'options', message: 'Add at least two options' }]);
    if (!needs && options?.length) throw AppError.validation([{ field: 'options', message: 'Only choice fields have options' }]);
  }

  private async find(id: string) {
    const d = await CustomFieldDefinition.findByPk(id);
    if (!d) throw AppError.notFound('Custom field');
    return d;
  }

  private presentDefinition(d: CustomFieldDefinition) {
    return {
      id: d.id,
      key: d.key,
      label: d.label,
      type: d.type,
      options: d.options,
      required: d.required,
      sensitive: d.sensitive,
      employeeEditable: d.employeeEditable,
      section: d.section,
      helpText: d.helpText,
      sortOrder: d.sortOrder,
      archived: !!d.archivedAt,
    };
  }
}
