import { Injectable } from '@nestjs/common';
import { fn, col, Op, UniqueConstraintError, type Transaction } from 'sequelize';
import { STATUTORY_COUNTRY, convertAmount, type ExchangeRateView, type LegalEntityView } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Employee, ExchangeRate, LegalEntity, Organization, PayGroup, PayrollRun } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { AssignEntityDto, ExchangeRateDto, LegalEntityDto } from './entities.dto';

/** Where an employee is paid from: their entity's currency and whether Indian statutory payroll applies. */
export interface PayContext {
  entityId: string | null;
  currency: string;
  country: string;
  statutory: boolean;
}

/**
 * Legal entities and currencies. An organization can employ people through several companies (entities), each with
 * its country, currency and registrations; one is the default for anyone not assigned. Pay groups are paid by an
 * entity, so a payroll run and its payslips are in that entity's currency, and Indian statutory deductions apply only
 * to Indian entities. Exchange rates (base-currency units per unit, by date) convert expense receipts in other
 * currencies and consolidate figures in the organization's base currency.
 */
@Injectable()
export class EntitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ---- Entities --------------------------------------------------------------------------------

  async list(): Promise<LegalEntityView[]> {
    const [entities, employeeCounts, groupCounts] = await Promise.all([
      LegalEntity.findAll({ order: [['isDefault', 'DESC'], ['name', 'ASC']] }),
      Employee.findAll({ attributes: ['legalEntityId', [fn('COUNT', col('id')), 'count']], where: { status: ['ACTIVE', 'ON_NOTICE'], legalEntityId: { [Op.ne]: null } }, group: ['legalEntityId'], raw: true }) as unknown as Promise<{ legalEntityId: string; count: string }[]>,
      PayGroup.findAll({ attributes: ['legalEntityId', [fn('COUNT', col('id')), 'count']], where: { legalEntityId: { [Op.ne]: null } }, group: ['legalEntityId'], raw: true }) as unknown as Promise<{ legalEntityId: string; count: string }[]>,
    ]);
    const unassigned = await Employee.count({ where: { status: ['ACTIVE', 'ON_NOTICE'], legalEntityId: null } });
    const emp = new Map(employeeCounts.map((c) => [c.legalEntityId, Number(c.count)]));
    const groups = new Map(groupCounts.map((c) => [c.legalEntityId, Number(c.count)]));
    return entities.map((e) => this.present(e, (emp.get(e.id) ?? 0) + (e.isDefault ? unassigned : 0), groups.get(e.id) ?? 0));
  }

  async create(auth: AuthContext, dto: LegalEntityDto) {
    const first = !(await LegalEntity.count());
    const id = await this.guard(() =>
      this.db.transaction(async (transaction) => {
        const makeDefault = first || !!dto.isDefault;
        if (makeDefault) await LegalEntity.update({ isDefault: false }, { where: { isDefault: true }, transaction });
        const e = await LegalEntity.create({ organizationId: auth.organizationId!, ...this.values(dto), isDefault: makeDefault, createdById: auth.userId, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'organization.entity_created', entityType: 'LegalEntity', entityId: e.id, summary: `Legal entity "${e.name}" (${e.country}, ${e.currency}) created` }, transaction);
        return e.id;
      }),
    );
    return (await this.list()).find((e) => e.id === id)!;
  }

  async update(auth: AuthContext, id: string, dto: LegalEntityDto) {
    const e = await this.find(id);
    if (dto.currency !== e.currency || dto.country !== e.country) {
      // Payroll in progress keeps the currency and rules it started with.
      const groups = (await PayGroup.findAll({ where: { legalEntityId: id }, attributes: ['id'] })).map((g) => g.id);
      if (groups.length && (await PayrollRun.count({ where: { payGroupId: groups, status: ['DRAFT', 'SUBMITTED'] } }))) throw AppError.conflict(`Finish or cancel the open payroll runs of ${e.name}'s pay groups before changing its country or currency`);
    }
    await this.guard(() =>
      this.db.transaction(async (transaction) => {
        if (dto.isDefault && !e.isDefault) await LegalEntity.update({ isDefault: false }, { where: { isDefault: true }, transaction });
        await e.update({ ...this.values(dto), isDefault: e.isDefault || !!dto.isDefault, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'organization.entity_updated', entityType: 'LegalEntity', entityId: id, summary: `Legal entity "${e.name}" updated` }, transaction);
      }),
    );
    return (await this.list()).find((x) => x.id === id)!;
  }

  async remove(id: string) {
    const e = await this.find(id);
    if (e.isDefault) throw AppError.conflict('Make another entity the default first');
    if (await Employee.count({ where: { legalEntityId: id } })) throw AppError.conflict(`Move ${e.name}'s employees to another entity first`);
    if (await PayGroup.count({ where: { legalEntityId: id } })) throw AppError.conflict(`Move ${e.name}'s pay groups to another entity first`);
    await this.db.transaction(async (transaction) => {
      await e.destroy({ transaction });
      await this.audit.record({ action: 'organization.entity_deleted', entityType: 'LegalEntity', entityId: id, summary: `Legal entity "${e.name}" deleted` }, transaction);
    });
  }

  /** Moves employees to an entity (null = the default). */
  async assign(auth: AuthContext, dto: AssignEntityDto) {
    if (dto.legalEntityId) await this.find(dto.legalEntityId);
    const found = await Employee.count({ where: { id: dto.employeeIds } });
    if (found !== new Set(dto.employeeIds).size) throw AppError.validation([{ field: 'employeeIds', message: 'Some employees were not found' }]);
    await this.db.transaction(async (transaction) => {
      await Employee.update({ legalEntityId: dto.legalEntityId ?? null, updatedById: auth.userId }, { where: { id: dto.employeeIds }, transaction });
      await this.audit.record({ action: 'organization.entity_assigned', entityType: 'LegalEntity', entityId: dto.legalEntityId ?? null, summary: `${dto.employeeIds.length} employee${dto.employeeIds.length === 1 ? '' : 's'} moved to ${dto.legalEntityId ? 'another entity' : 'the default entity'}`, metadata: { employeeIds: dto.employeeIds } }, transaction);
    });
    return this.list();
  }

  /** The entity a pay group (or the main run, null) pays from: its currency and statutory rules. */
  async payContextForGroup(organizationId: string, payGroupId: string | null, transaction?: Transaction): Promise<PayContext> {
    const group = payGroupId ? await PayGroup.findByPk(payGroupId, { attributes: ['legalEntityId'], transaction }) : null;
    const entity = group?.legalEntityId ? await LegalEntity.findByPk(group.legalEntityId, { transaction }) : await LegalEntity.findOne({ where: { isDefault: true }, transaction });
    if (entity) return { entityId: entity.id, currency: entity.currency, country: entity.country, statutory: entity.country === STATUTORY_COUNTRY };
    const org = await Organization.findByPk(organizationId, { attributes: ['currency', 'country'], transaction });
    const country = org?.country ?? STATUTORY_COUNTRY;
    return { entityId: null, currency: org?.currency ?? 'INR', country, statutory: country === STATUTORY_COUNTRY };
  }

  /** The currency an employee is paid in and claims expenses in. */
  async payCurrencyOf(organizationId: string, employee: Pick<Employee, 'legalEntityId'>, transaction?: Transaction): Promise<string> {
    const entity = employee.legalEntityId ? await LegalEntity.findByPk(employee.legalEntityId, { attributes: ['currency'], transaction }) : await LegalEntity.findOne({ where: { isDefault: true }, attributes: ['currency'], transaction });
    return entity?.currency ?? (await this.baseCurrency(organizationId, transaction));
  }

  // ---- Exchange rates --------------------------------------------------------------------------

  async rates(organizationId: string): Promise<{ base: string; rates: ExchangeRateView[]; latest: ExchangeRateView[] }> {
    const rows = await ExchangeRate.findAll({ order: [['currency', 'ASC'], ['effectiveOn', 'DESC']], limit: 1000 });
    const views = rows.map((r) => ({ id: r.id, currency: r.currency, rate: Number(r.rate), effectiveOn: r.effectiveOn, source: r.source }));
    // Newest first per currency, so the first seen is the one in force.
    const latest = new Map<string, ExchangeRateView>();
    for (const v of views) if (!latest.has(v.currency)) latest.set(v.currency, v);
    return { base: await this.baseCurrency(organizationId), rates: views, latest: [...latest.values()] };
  }

  async setRate(auth: AuthContext, dto: ExchangeRateDto) {
    const base = await this.baseCurrency(auth.organizationId!);
    if (dto.currency === base) throw AppError.validation([{ field: 'currency', message: `${base} is the base currency (always 1)` }]);
    await this.db.transaction(async (transaction) => {
      const existing = await ExchangeRate.findOne({ where: { currency: dto.currency, effectiveOn: dto.effectiveOn }, transaction });
      if (existing) await existing.update({ rate: String(dto.rate), source: dto.source ?? null }, { transaction });
      else await ExchangeRate.create({ organizationId: auth.organizationId!, currency: dto.currency, rate: String(dto.rate), effectiveOn: dto.effectiveOn, source: dto.source ?? null, createdById: auth.userId }, { transaction });
      await this.audit.record({ action: 'payroll.exchange_rate_set', entityType: 'ExchangeRate', entityId: null, summary: `1 ${dto.currency} = ${dto.rate} ${base} from ${dto.effectiveOn}` }, transaction);
    });
    return this.rates(auth.organizationId!);
  }

  async removeRate(auth: AuthContext, id: string) {
    const r = await ExchangeRate.findByPk(id);
    if (!r) throw AppError.notFound('Exchange rate');
    await r.destroy();
    await this.audit.record({ action: 'payroll.exchange_rate_deleted', entityType: 'ExchangeRate', entityId: id, summary: `Rate for ${r.currency} from ${r.effectiveOn} deleted` });
    return this.rates(auth.organizationId!);
  }

  /** Base-currency units per unit of each currency on a date (base = 1). */
  async ratesOn(organizationId: string, on: string, currencies: string[], transaction?: Transaction): Promise<Map<string, number>> {
    const base = await this.baseCurrency(organizationId, transaction);
    const out = new Map<string, number>([[base, 1]]);
    const wanted = [...new Set(currencies.filter((c) => c !== base))];
    if (!wanted.length) return out;
    const rows = await ExchangeRate.findAll({ where: { currency: wanted, effectiveOn: { [Op.lte]: on } }, order: [['effectiveOn', 'DESC']], transaction });
    for (const r of rows) if (!out.has(r.currency)) out.set(r.currency, Number(r.rate));
    return out;
  }

  /** `amount` in `from` converted to `to` at the rates on a date; null when a rate is missing. */
  async convert(organizationId: string, amount: number, from: string, to: string, on: string, transaction?: Transaction): Promise<{ amount: number; rate: number } | null> {
    if (from === to) return { amount, rate: 1 };
    const rates = await this.ratesOn(organizationId, on, [from, to], transaction);
    const converted = convertAmount(amount, from, to, rates);
    if (converted === null) return null;
    return { amount: converted, rate: Math.round((rates.get(from)! / rates.get(to)!) * 1e8) / 1e8 };
  }

  private async baseCurrency(organizationId: string, transaction?: Transaction): Promise<string> {
    return (await Organization.findByPk(organizationId, { attributes: ['currency'], transaction }))?.currency ?? 'INR';
  }

  private values(dto: LegalEntityDto) {
    return {
      name: dto.name,
      legalName: dto.legalName,
      country: dto.country,
      currency: dto.currency,
      registrations: dto.registrations ?? [],
      addressLine1: dto.addressLine1 ?? null,
      addressLine2: dto.addressLine2 ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      postalCode: dto.postalCode ?? null,
    };
  }

  private async find(id: string) {
    const e = await LegalEntity.findByPk(id);
    if (!e) throw AppError.notFound('Legal entity');
    return e;
  }

  private present(e: LegalEntity, employees: number, payGroups: number): LegalEntityView {
    return {
      id: e.id,
      name: e.name,
      legalName: e.legalName,
      country: e.country,
      currency: e.currency,
      registrations: e.registrations ?? [],
      address: { line1: e.addressLine1, line2: e.addressLine2, city: e.city, state: e.state, postalCode: e.postalCode },
      isDefault: e.isDefault,
      statutory: e.country === STATUTORY_COUNTRY,
      employees,
      payGroups,
    };
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'name', message: 'An entity with this name already exists' }]);
      throw e;
    }
  }
}
