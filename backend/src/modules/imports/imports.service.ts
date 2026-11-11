import { Injectable } from '@nestjs/common';
import { isISO8601 } from 'class-validator';
import { Op } from 'sequelize';
import { ASSET_CATEGORIES, ASSET_CONDITIONS, type AssetCategory, type AssetCondition, type ModuleKey } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { csvCell, CsvError, parseCsv } from '../../common/utils/csv';
import { CustomFieldDefinition, Employee, LeaveType, Location, SalaryStructure } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { coerceValue, CustomFieldsService } from '../employees/custom-fields.service';
import { IMPORT_FILE_MAX_BYTES } from '../employees/employee-import.service';
import { LeaveBalanceService } from '../leave/leave-balance.service';
import { SalariesService } from '../payroll/salaries.service';
import { AssetsService } from '../services/assets.service';

export const IMPORT_MAX_ROWS = 5000;
const MAX_REPORTED = 500;

export interface ImportIssue {
  row: number;
  column: string | null;
  message: string;
}

interface Column {
  header: string;
  required?: boolean;
  example: string;
  help?: string;
}

interface Prepared<T> {
  line: number;
  label: string;
  payload: T;
}

interface Importer<T = unknown> {
  key: string;
  label: string;
  description: string;
  /** All are needed. */
  permissions: string[];
  feature?: ModuleKey;
  columns(auth: AuthContext): Promise<Column[]>;
  prepare(auth: AuthContext, rows: { line: number; get: (h: string) => string }[], issue: (row: number, column: string | null, message: string) => void): Promise<Prepared<T>[]>;
  /** 'PENDING' when the row went into an approval queue instead of taking effect. */
  apply(auth: AuthContext, row: Prepared<T>): Promise<void | 'PENDING'>;
}

const normalize = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && isISO8601(v, { strict: true });
const yesNo = (v: string) => (/^(yes|y|true|1)$/i.test(v) ? true : /^(no|n|false|0)$/i.test(v) ? false : null);

/**
 * Bulk imports from CSV, one per module: opening leave balances, salaries, assets and custom employee fields (employees
 * themselves have their own import). The whole file is checked first — nothing is applied if any row has a problem —
 * then each row is applied through the same rules as the screens (audited, notified), and any row refused at that
 * point is reported back.
 */
@Injectable()
export class ImportsService {
  private readonly importers: Importer[];

  constructor(
    private readonly audit: AuditService,
    private readonly leave: LeaveBalanceService,
    private readonly salaries: SalariesService,
    private readonly assets: AssetsService,
    private readonly customFields: CustomFieldsService,
  ) {
    this.importers = [this.leaveBalances(), this.salaryImport(), this.assetImport(), this.customFieldImport()] as Importer[];
  }

  async available(auth: AuthContext) {
    return Promise.all(
      this.importers
        .filter((i) => this.allowed(auth, i))
        .map(async (i) => ({ key: i.key, label: i.label, description: i.description, columns: (await i.columns(auth)).map((c) => ({ header: c.header, required: !!c.required, help: c.help ?? null })) })),
    );
  }

  async template(auth: AuthContext, key: string) {
    const i = this.find(auth, key);
    const cols = await i.columns(auth);
    return { fileName: `${i.key}-import-template.csv`, content: `${cols.map((c) => csvCell(c.header)).join(',')}\r\n${cols.map((c) => csvCell(c.example)).join(',')}\r\n`, columns: cols };
  }

  async import(auth: AuthContext, key: string, file: { buffer: Buffer; size: number } | undefined, dryRun: boolean) {
    const importer = this.find(auth, key);
    if (!file?.buffer?.length) throw AppError.validation([{ field: 'file', message: 'Choose a CSV file to import' }]);
    if (file.size > IMPORT_FILE_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The file must be 10 MB or smaller' }]);
    let table: string[][];
    try {
      table = parseCsv(file.buffer.toString('utf8').replace(/^\uFEFF/, ''), IMPORT_MAX_ROWS + 1);
    } catch (e) {
      if (e instanceof CsvError) throw AppError.validation([{ field: 'file', message: `${e.message}. Up to ${IMPORT_MAX_ROWS.toLocaleString('en')} rows can be imported at once.` }]);
      throw e;
    }
    if (table.length < 2) throw AppError.validation([{ field: 'file', message: 'The file has no rows. Download the template to see the columns.' }]);
    const header = table[0]!.map(normalize);
    const columns = await importer.columns(auth);
    const missing = columns.filter((c) => c.required && !header.includes(c.header)).map((c) => c.header);
    if (missing.length) throw AppError.validation([{ field: 'file', message: `Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` }]);
    const known = new Set(columns.map((c) => c.header));
    const ignored = table[0]!.filter((h, i) => h.trim() && !known.has(header[i]!));

    const issues: ImportIssue[] = [];
    let issueCount = 0;
    const issue = (row: number, column: string | null, message: string) => {
      issueCount++;
      if (issues.length < MAX_REPORTED) issues.push({ row, column, message });
    };
    const rows = table
      .slice(1)
      .map((cells, i) => ({ line: i + 2, cells }))
      .filter((r) => r.cells.some((c) => c.trim()))
      .map((r) => ({ line: r.line, get: (h: string) => (header.indexOf(h) >= 0 ? (r.cells[header.indexOf(h)] ?? '').trim() : '') }));
    for (const r of rows) for (const c of columns) if (c.required && !r.get(c.header)) issue(r.line, c.header, `${c.header} is required`);
    const prepared = await importer.prepare(auth, rows, issue);
    const invalidRows = new Set(issues.map((i) => i.row)).size;
    const summary = { importer: importer.key, dryRun, total: rows.length, valid: rows.length - invalidRows, invalid: invalidRows, applied: 0, pendingApproval: 0, failed: 0, ignoredColumns: ignored, issues, issueCount };
    if (dryRun || issueCount) return summary;

    for (const row of prepared) {
      try {
        if ((await importer.apply(auth, row)) === 'PENDING') summary.pendingApproval++;
        else summary.applied++;
      } catch (e) {
        summary.failed++;
        issue(row.line, null, `${row.label}: ${e instanceof AppError ? (e.details?.[0]?.message ?? e.message) : 'could not be saved'}`);
      }
    }
    summary.issueCount = issueCount;
    await this.audit.record({ action: 'imports.completed', entityType: 'Import', entityId: null, summary: `${importer.label} import: ${summary.applied} of ${rows.length} rows applied`, metadata: { importer: importer.key, applied: summary.applied, pendingApproval: summary.pendingApproval, failed: summary.failed } });
    return summary;
  }

  // ---- importers -------------------------------------------------------------------------------

  private allowed(auth: AuthContext, i: Importer) {
    return i.permissions.every((p) => auth.permissions.has(p)) && (!i.feature || auth.features.has(i.feature));
  }

  private find(auth: AuthContext, key: string): Importer {
    const i = this.importers.find((x) => x.key === key);
    if (!i) throw AppError.notFound('Import');
    if (!this.allowed(auth, i)) throw AppError.forbidden();
    return i;
  }

  /** Employees by code (case-insensitive). */
  private async employeesByCode(rows: { line: number; get: (h: string) => string }[], column: string, issue: (row: number, column: string | null, message: string) => void) {
    const codes = [...new Set(rows.map((r) => r.get(column)).filter(Boolean))];
    const patterns = codes.map((c) => c.replace(/[\\%_]/g, (ch) => `\\${ch}`));
    const found = codes.length ? await Employee.findAll({ where: { employeeCode: { [Op.iLike]: { [Op.any]: patterns } } }, attributes: ['id', 'employeeCode', 'firstName', 'lastName'] }) : [];
    const byCode = new Map(found.map((e) => [e.employeeCode.toLowerCase(), e]));
    const lookup = (r: { line: number; get: (h: string) => string }) => {
      const code = r.get(column);
      if (!code) return null;
      const e = byCode.get(code.toLowerCase());
      if (!e) issue(r.line, column, `No employee with code ${code}`);
      return e ?? null;
    };
    return lookup;
  }

  private leaveBalances(): Importer<{ employeeId: string; leaveTypeId: string; days: number; kind: 'GRANT' | 'ADJUSTMENT'; note: string }> {
    return {
      key: 'leave-balances',
      label: 'Leave balances',
      description: 'Opening balances or corrections for the current leave year',
      permissions: ['leave.view', 'leave.allocate'],
      feature: 'leave',
      columns: async () => [
        { header: 'employee_code', required: true, example: 'EMP-0001' },
        { header: 'leave_type', required: true, example: 'EL', help: 'Leave type code or name' },
        { header: 'days', required: true, example: '12', help: 'Whole or half days; negative to reduce (kind ADJUSTMENT)' },
        { header: 'kind', example: 'GRANT', help: 'GRANT (default) or ADJUSTMENT' },
        { header: 'note', example: 'Opening balance' },
      ],
      prepare: async (_auth, rows, issue) => {
        const employee = await this.employeesByCode(rows, 'employee_code', issue);
        const types = await LeaveType.findAll({ attributes: ['id', 'code', 'name'] });
        const typeOf = (v: string) => types.find((t) => t.code.toLowerCase() === v.toLowerCase() || t.name.toLowerCase() === v.toLowerCase());
        const out = [];
        for (const r of rows) {
          const e = employee(r);
          const typeValue = r.get('leave_type');
          const t = typeValue ? typeOf(typeValue) : null;
          if (typeValue && !t) issue(r.line, 'leave_type', `No leave type "${typeValue}"`);
          const days = Number(r.get('days'));
          if (r.get('days') && (!Number.isFinite(days) || !Number.isInteger(days * 2) || days === 0)) issue(r.line, 'days', 'Use whole or half days (not zero)');
          const kind = (r.get('kind') || 'GRANT').toUpperCase();
          if (kind !== 'GRANT' && kind !== 'ADJUSTMENT') issue(r.line, 'kind', 'Use GRANT or ADJUSTMENT');
          else if (kind === 'GRANT' && days < 0) issue(r.line, 'days', 'A grant adds days; use ADJUSTMENT to reduce');
          if (e && t) out.push({ line: r.line, label: `${e.employeeCode} ${t.code}`, payload: { employeeId: e.id, leaveTypeId: t.id, days, kind: kind as 'GRANT' | 'ADJUSTMENT', note: r.get('note') || 'Imported' } });
        }
        return out;
      },
      apply: async (auth, row) => {
        await this.leave.adjust(auth, row.payload);
      },
    };
  }

  private salaryImport(): Importer<{ employeeId: string; structureId: string; annualCtc: number; effectiveFrom: string; pfApplicable?: boolean; reason: string | null }> {
    return {
      key: 'salaries',
      label: 'Salaries',
      description: 'Annual CTC from a date for each employee (revisions keep the history)',
      permissions: ['employee.salary.revise'],
      feature: 'payroll',
      columns: async () => [
        { header: 'employee_code', required: true, example: 'EMP-0001' },
        { header: 'annual_ctc', required: true, example: '1200000' },
        { header: 'effective_from', required: true, example: '2026-04-01', help: 'YYYY-MM-DD' },
        { header: 'structure', example: 'Standard', help: 'Salary structure name (default: the only active one)' },
        { header: 'pf_applicable', example: 'yes' },
        { header: 'reason', example: 'Opening salary' },
      ],
      prepare: async (_auth, rows, issue) => {
        const employee = await this.employeesByCode(rows, 'employee_code', issue);
        const structures = await SalaryStructure.findAll({ where: { isActive: true }, attributes: ['id', 'name'] });
        const out = [];
        for (const r of rows) {
          const e = employee(r);
          const name = r.get('structure');
          const s = name ? structures.find((x) => x.name.toLowerCase() === name.toLowerCase()) : structures.length === 1 ? structures[0] : null;
          if (name && !s) issue(r.line, 'structure', `No active salary structure "${name}"`);
          if (!name && !s) issue(r.line, 'structure', structures.length ? 'Name the salary structure (there are several)' : 'Set up a salary structure first');
          const ctc = Number(r.get('annual_ctc').replace(/[,\s₹]/g, ''));
          if (r.get('annual_ctc') && (!Number.isFinite(ctc) || ctc <= 0)) issue(r.line, 'annual_ctc', 'Enter the annual CTC as a number');
          const from = r.get('effective_from');
          if (from && !isDate(from)) issue(r.line, 'effective_from', 'Use YYYY-MM-DD');
          const pf = r.get('pf_applicable') ? yesNo(r.get('pf_applicable')) : undefined;
          if (pf === null) issue(r.line, 'pf_applicable', 'Use yes or no');
          if (e && s) out.push({ line: r.line, label: e.employeeCode, payload: { employeeId: e.id, structureId: s.id, annualCtc: ctc, effectiveFrom: from, ...(pf !== undefined && pf !== null ? { pfApplicable: pf } : {}), reason: r.get('reason') || null } });
        }
        return out;
      },
      apply: async (auth, row) => {
        const { employeeId, ...dto } = row.payload;
        const saved = (await this.salaries.create(auth, employeeId, dto)) as { pendingApproval?: boolean };
        return saved?.pendingApproval ? 'PENDING' : undefined;
      },
    };
  }

  private assetImport(): Importer<{ asset: Record<string, unknown>; assignTo: string | null }> {
    return {
      key: 'assets',
      label: 'Assets',
      description: 'Company equipment for the asset register, optionally handed over to someone',
      permissions: ['assets.manage'],
      feature: 'assets',
      columns: async () => [
        { header: 'name', required: true, example: 'MacBook Pro 14"' },
        { header: 'category', required: true, example: 'LAPTOP', help: ASSET_CATEGORIES.join(', ') },
        { header: 'tag', example: '', help: 'Leave empty to generate AST-0001…' },
        { header: 'serial_number', example: 'C02XK1ABCD' },
        { header: 'model', example: 'A2442' },
        { header: 'purchase_date', example: '2025-06-01' },
        { header: 'purchase_cost', example: '185000' },
        { header: 'warranty_until', example: '2028-06-01' },
        { header: 'condition', example: 'NEW', help: ASSET_CONDITIONS.join(', ') },
        { header: 'location', example: 'Bengaluru HQ' },
        { header: 'notes', example: '' },
        { header: 'assign_to', example: 'EMP-0001', help: 'Employee code to hand it to' },
      ],
      prepare: async (_auth, rows, issue) => {
        const assignee = await this.employeesByCode(rows, 'assign_to', issue);
        const locations = await Location.findAll({ attributes: ['id', 'name'] });
        const out = [];
        const tags = new Set<string>();
        for (const r of rows) {
          const category = r.get('category').toUpperCase().replace(/\s+/g, '_');
          if (r.get('category') && !(ASSET_CATEGORIES as readonly string[]).includes(category)) issue(r.line, 'category', `Use one of ${ASSET_CATEGORIES.join(', ')}`);
          const condition = r.get('condition').toUpperCase();
          if (condition && !(ASSET_CONDITIONS as readonly string[]).includes(condition)) issue(r.line, 'condition', `Use one of ${ASSET_CONDITIONS.join(', ')}`);
          for (const d of ['purchase_date', 'warranty_until']) if (r.get(d) && !isDate(r.get(d))) issue(r.line, d, 'Use YYYY-MM-DD');
          const cost = r.get('purchase_cost') ? Number(r.get('purchase_cost').replace(/[,\s₹]/g, '')) : null;
          if (cost !== null && (!Number.isFinite(cost) || cost < 0)) issue(r.line, 'purchase_cost', 'Enter a number');
          const loc = r.get('location') ? locations.find((l) => l.name.toLowerCase() === r.get('location').toLowerCase()) : null;
          if (r.get('location') && !loc) issue(r.line, 'location', `No location "${r.get('location')}"`);
          const tag = r.get('tag').toUpperCase();
          if (tag && tags.has(tag)) issue(r.line, 'tag', `Tag ${tag} appears twice in the file`);
          if (tag) tags.add(tag);
          const who = assignee(r);
          out.push({
            line: r.line,
            label: r.get('name') || `Row ${r.line}`,
            payload: {
              asset: {
                name: r.get('name'),
                category: category as AssetCategory,
                tag: tag || null,
                serialNumber: r.get('serial_number') || null,
                model: r.get('model') || null,
                purchaseDate: r.get('purchase_date') || null,
                purchaseCost: cost,
                warrantyUntil: r.get('warranty_until') || null,
                ...(condition ? { condition: condition as AssetCondition } : {}),
                locationId: loc?.id ?? null,
                notes: r.get('notes') || null,
              },
              assignTo: who?.id ?? null,
            },
          });
        }
        return out;
      },
      apply: async (auth, row) => {
        const created = (await this.assets.create(auth, row.payload.asset as never)) as { id: string };
        if (row.payload.assignTo) await this.assets.assign(auth, created.id, { employeeId: row.payload.assignTo });
      },
    };
  }

  private customFieldImport(): Importer<{ employeeId: string; values: Record<string, unknown> }> {
    return {
      key: 'custom-fields',
      label: 'Custom fields',
      description: 'Fill in custom employee fields for many people at once (empty cells are left unchanged)',
      permissions: ['employee.view', 'employee.update'],
      columns: async () => {
        const defs = await CustomFieldDefinition.findAll({ where: { entity: 'EMPLOYEE', archivedAt: null }, order: [['sortOrder', 'ASC']] });
        return [{ header: 'employee_code', required: true, example: 'EMP-0001' }, ...defs.map((d) => ({ header: d.key, example: d.options[0] ?? (d.type === 'BOOLEAN' ? 'yes' : d.type === 'DATE' ? '2026-01-31' : d.type === 'NUMBER' ? '1' : ''), help: d.label }))];
      },
      prepare: async (_auth, rows, issue) => {
        const employee = await this.employeesByCode(rows, 'employee_code', issue);
        const defs = await CustomFieldDefinition.findAll({ where: { entity: 'EMPLOYEE', archivedAt: null } });
        const out = [];
        for (const r of rows) {
          const e = employee(r);
          const values: Record<string, unknown> = {};
          for (const d of defs) {
            const raw = r.get(d.key);
            if (!raw) continue;
            try {
              values[d.key] = coerceValue(d, d.type === 'BOOLEAN' ? (yesNo(raw) ?? raw) : raw);
            } catch (err) {
              issue(r.line, d.key, err instanceof AppError ? (err.details?.[0]?.message ?? err.message) : 'Invalid value');
            }
          }
          if (e && Object.keys(values).length) out.push({ line: r.line, label: e.employeeCode, payload: { employeeId: e.id, values } });
        }
        return out;
      },
      apply: async (auth, row) => {
        await this.customFields.setValues(auth, row.payload.employeeId, row.payload.values);
      },
    };
  }
}
