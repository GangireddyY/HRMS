import { Injectable } from '@nestjs/common';
import { BUILT_IN_CONTRIBUTION_RATES, contributionRatesProblem, financialYearLabel, financialYearOf, taxRuleSetProblem, type ContributionRates, type TaxRuleSet } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { zonedParts } from '../../common/utils/zoned-time';
import { StatutoryContributionRate, StatutoryTaxRules } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { ContributionRatesDto, TaxRulesDto } from './dto/statutory-rates.dto';
import { BUILT_IN_TAX_RULES, builtInRules, FIRST_TAX_FY, type YearRules } from './tax-rules';

const CACHE_MS = 60_000;
/** Statutory dates are Indian dates. */
const today = () => zonedParts(new Date(), 'Asia/Kolkata').date;

export interface RatesInForce extends ContributionRates {
  /** Since when (null = the built-in set). */
  effectiveFrom: string | null;
}
export interface TaxRulesInForce extends YearRules {
  source: 'ENTERED' | 'BUILT_IN';
  /** False when a later year borrows an earlier year's rules because its own haven't been entered. */
  confirmed: boolean;
}

const toRates = (r: StatutoryContributionRate): RatesInForce => ({
  effectiveFrom: r.effectiveFrom,
  pfRate: Number(r.pfRate),
  epsRate: Number(r.epsRate),
  pfWageCeiling: r.pfWageCeiling,
  esiEmployeeRate: Number(r.esiEmployeeRate),
  esiEmployerRate: Number(r.esiEmployerRate),
  esiWageLimit: r.esiWageLimit,
});

/**
 * Statutory rates as data (Platform → Statutory rates, `platform.statutory.manage`): PF / EPS / ESI rates and limits
 * from an effective date, and each financial year's income-tax rules. Payroll for a month uses the contribution rates
 * in force on its first day and its financial year's tax rules; without entries the built-in values apply. Draft runs
 * pick up a change when recalculated; approved payslips keep their figures.
 */
@Injectable()
export class StatutoryRatesService {
  private cache: { at: number; contribution: StatutoryContributionRate[]; tax: Map<number, StatutoryTaxRules> } | null = null;

  constructor(private readonly audit: AuditService) {}

  private async load() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const [contribution, tax] = await Promise.all([StatutoryContributionRate.findAll({ order: [['effectiveFrom', 'ASC']] }), StatutoryTaxRules.findAll()]);
    this.cache = { at: Date.now(), contribution, tax: new Map(tax.map((t) => [t.financialYear, t])) };
    return this.cache;
  }

  /** The PF / EPS / ESI rates in force on the first day of the month. */
  async contributionRates(year: number, month: number): Promise<RatesInForce> {
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const row = [...(await this.load()).contribution].reverse().find((r) => r.effectiveFrom <= first);
    return row ? toRates(row) : { ...BUILT_IN_CONTRIBUTION_RATES, effectiveFrom: null };
  }

  /** A financial year's income-tax rules: entered, built in, or (not confirmed) the latest earlier year's. */
  async taxRules(fy: number): Promise<TaxRulesInForce> {
    const { tax } = await this.load();
    const entered = tax.get(fy);
    if (entered) return { year: fy, set: entered.rules, source: 'ENTERED', confirmed: true };
    if (BUILT_IN_TAX_RULES[fy]) return { ...builtInRules(fy), source: 'BUILT_IN', confirmed: true };
    const earlier = [...tax.keys()].filter((y) => y < fy).sort((a, b) => b - a)[0];
    const builtIn = builtInRules(fy);
    if (earlier !== undefined && earlier > builtIn.year) return { year: earlier, set: tax.get(earlier)!.rules, source: 'ENTERED', confirmed: false };
    return { ...builtIn, source: 'BUILT_IN', confirmed: false };
  }

  async overview() {
    const { contribution, tax } = await this.load();
    const now = today();
    const [y, m] = now.split('-').map(Number) as [number, number];
    const currentFy = financialYearOf(y, m);
    const inForce = await this.contributionRates(y, m);
    const lastYear = Math.max(currentFy + 1, ...tax.keys());
    const years = [];
    for (let fy = FIRST_TAX_FY; fy <= lastYear; fy++) {
      const r = await this.taxRules(fy);
      const row = tax.get(fy);
      years.push({ financialYear: fy, label: financialYearLabel(fy), source: r.source, confirmed: r.confirmed, rulesYear: r.year, rules: r.set, note: row?.source ?? null, updatedAt: row?.updatedAt ?? null });
    }
    return {
      today: now,
      currentFinancialYear: currentFy,
      contribution: {
        builtIn: BUILT_IN_CONTRIBUTION_RATES,
        inForce,
        entries: contribution.map((r) => ({ id: r.id, ...toRates(r), source: r.source, updatedAt: r.updatedAt, upcoming: r.effectiveFrom > now })),
      },
      tax: years,
    };
  }

  async saveContribution(auth: AuthContext, dto: ContributionRatesDto) {
    const rates: ContributionRates = { pfRate: dto.pfRate, epsRate: dto.epsRate, pfWageCeiling: dto.pfWageCeiling, esiEmployeeRate: dto.esiEmployeeRate, esiEmployerRate: dto.esiEmployerRate, esiWageLimit: dto.esiWageLimit };
    const problem = contributionRatesProblem(rates);
    if (problem) throw AppError.validation([{ field: 'pfRate', message: problem }]);
    const existing = await StatutoryContributionRate.findOne({ where: { effectiveFrom: dto.effectiveFrom } });
    const values = { ...rates, pfRate: String(rates.pfRate), epsRate: String(rates.epsRate), esiEmployeeRate: String(rates.esiEmployeeRate), esiEmployerRate: String(rates.esiEmployerRate), source: dto.source ?? null, updatedById: auth.userId };
    const row = existing ? await existing.update(values) : await StatutoryContributionRate.create({ effectiveFrom: dto.effectiveFrom, ...values });
    await this.audit.record({
      organizationId: null, action: 'platform.statutory_rates_saved',
      entityType: 'StatutoryContributionRate',
      entityId: row.id,
      summary: `PF / ESI rates from ${dto.effectiveFrom} ${existing ? 'updated' : 'added'}`,
      metadata: { effectiveFrom: dto.effectiveFrom, ...rates, source: dto.source ?? null },
    });
    this.cache = null;
    return this.overview();
  }

  async removeContribution(auth: AuthContext, id: string) {
    const row = await StatutoryContributionRate.findByPk(id);
    if (!row) throw AppError.notFound('Rates');
    await row.destroy();
    await this.audit.record({ organizationId: null, action: 'platform.statutory_rates_removed', entityType: 'StatutoryContributionRate', entityId: id, summary: `PF / ESI rates from ${row.effectiveFrom} removed`, metadata: { ...toRates(row) } });
    this.cache = null;
    return this.overview();
  }

  async saveTaxRules(auth: AuthContext, fy: number, dto: TaxRulesDto) {
    if (!Number.isInteger(fy) || fy < FIRST_TAX_FY || fy > 2100) throw AppError.validation([{ field: 'financialYear', message: `Choose ${financialYearLabel(FIRST_TAX_FY)} or later` }]);
    const rules = normalize(dto.rules);
    const problem = rules ? taxRuleSetProblem(rules) : 'Both regimes and the cess are needed';
    if (problem) throw AppError.validation([{ field: 'rules', message: problem }]);
    const existing = await StatutoryTaxRules.findByPk(fy);
    if (existing) await existing.update({ rules: rules!, source: dto.source ?? null, updatedById: auth.userId });
    else await StatutoryTaxRules.create({ financialYear: fy, rules: rules!, source: dto.source ?? null, updatedById: auth.userId });
    await this.audit.record({
      organizationId: null, action: 'platform.tax_rules_saved',
      entityType: 'StatutoryTaxRules',
      entityId: null,
      summary: `Income-tax rules for ${financialYearLabel(fy)} ${existing ? 'updated' : 'entered'}`,
      metadata: { financialYear: fy, source: dto.source ?? null, rules },
    });
    this.cache = null;
    return this.overview();
  }

  async removeTaxRules(auth: AuthContext, fy: number) {
    const row = await StatutoryTaxRules.findByPk(fy);
    if (!row) throw AppError.notFound('Tax rules');
    await row.destroy();
    await this.audit.record({ organizationId: null, action: 'platform.tax_rules_removed', entityType: 'StatutoryTaxRules', entityId: null, summary: `Income-tax rules for ${financialYearLabel(fy)} removed (built-in rules apply)`, metadata: { financialYear: fy } });
    this.cache = null;
    return this.overview();
  }
}

/** Keeps only the known fields, as numbers (the rules are stored as given and used for real tax). */
function normalize(input: unknown): TaxRuleSet | null {
  const o = input as Partial<TaxRuleSet> | null;
  if (!o || typeof o !== 'object' || !o.NEW || !o.OLD) return null;
  const slabs = (s: unknown) => (Array.isArray(s) ? s.map((x: { upTo?: unknown; rate?: unknown }) => ({ upTo: x?.upTo === null || x?.upTo === undefined || x?.upTo === '' ? null : Number(x.upTo), rate: Number(x?.rate) })) : undefined);
  const regime = (r: TaxRuleSet['NEW']) => ({
    standardDeduction: Number(r.standardDeduction),
    slabs: slabs(r.slabs) ?? [],
    ...(r.slabsSenior?.length ? { slabsSenior: slabs(r.slabsSenior) } : {}),
    ...(r.slabsSuperSenior?.length ? { slabsSuperSenior: slabs(r.slabsSuperSenior) } : {}),
    rebateIncomeLimit: Number(r.rebateIncomeLimit),
    rebateMax: Number(r.rebateMax),
    rebateMarginalRelief: r.rebateMarginalRelief === true,
    surcharge: Array.isArray(r.surcharge) ? r.surcharge.map((s) => ({ above: Number(s?.above), rate: Number(s?.rate) })) : [],
  });
  return { NEW: regime(o.NEW), OLD: regime(o.OLD), cess: Number(o.cess) };
}
