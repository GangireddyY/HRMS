import { Injectable } from '@nestjs/common';
import { isEmail, isISO8601 } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { UniqueConstraintError } from 'sequelize';
import { EMPLOYEE_IMPORT_MAX_ROWS, EMPLOYMENT_TYPES, type EmploymentType, type Gender } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { csvCell, CsvError, parseCsv } from '../../common/utils/csv';
import { DatabaseService } from '../../database/database.service';
import { CostCenter, Department, Designation, Employee, EmployeeLifecycleEvent, Grade, Location } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';

export const IMPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_REPORTED_ERRORS = 500;
const CHUNK = 1000;

const COLUMNS = [
  { key: 'employeeCode', header: 'employee_code', example: '', help: 'Leave empty to generate (EMP-0001…)' },
  { key: 'firstName', header: 'first_name', example: 'Asha', required: true },
  { key: 'lastName', header: 'last_name', example: 'Rao', required: true },
  { key: 'workEmail', header: 'work_email', example: 'asha.rao@example.com' },
  { key: 'personalEmail', header: 'personal_email', example: '' },
  { key: 'phone', header: 'phone', example: '+91 98765 43210' },
  { key: 'dateOfBirth', header: 'date_of_birth', example: '1994-05-21' },
  { key: 'gender', header: 'gender', example: 'FEMALE' },
  { key: 'dateOfJoining', header: 'date_of_joining', example: '2024-01-15', required: true },
  { key: 'employmentType', header: 'employment_type', example: 'FULL_TIME' },
  { key: 'department', header: 'department', example: 'Engineering' },
  { key: 'designation', header: 'designation', example: 'Software Engineer' },
  { key: 'location', header: 'location', example: '' },
  { key: 'grade', header: 'grade', example: '' },
  { key: 'costCenter', header: 'cost_center', example: '' },
  { key: 'managerCode', header: 'manager_code', example: '' },
  { key: 'probationEndDate', header: 'probation_end_date', example: '' },
  { key: 'noticePeriodDays', header: 'notice_period_days', example: '60' },
] as const;
type ColumnKey = (typeof COLUMNS)[number]['key'];

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_/-]{0,29}$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const GENDER_ALIASES: Record<string, Gender> = {
  male: 'MALE', m: 'MALE', female: 'FEMALE', f: 'FEMALE',
  non_binary: 'NON_BINARY', nonbinary: 'NON_BINARY', undisclosed: 'UNDISCLOSED', prefer_not_to_say: 'UNDISCLOSED',
};
const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && isISO8601(v, { strict: true, strictSeparator: true });

export interface ImportIssue {
  row: number;
  column: string | null;
  message: string;
}

interface ParsedRow {
  line: number;
  id: string;
  employeeCode: string | null;
  managerCode: string | null;
  values: Partial<Employee>;
}

/** CSV import of new employees. Validates every row first; then creates all of them in one transaction, or none. */
@Injectable()
export class EmployeeImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  template(): string {
    return [COLUMNS.map((c) => c.header).join(','), COLUMNS.map((c) => csvCell(c.example)).join(',')].join('\r\n');
  }

  async import(auth: AuthContext, file: { buffer: Buffer; size: number } | undefined, dryRun: boolean) {
    if (!file?.buffer?.length) throw AppError.validation([{ field: 'file', message: 'Choose a CSV file to import' }]);
    if (file.size > IMPORT_FILE_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The file must be 10 MB or smaller' }]);

    let table: string[][];
    try {
      table = parseCsv(file.buffer.toString('utf8'), EMPLOYEE_IMPORT_MAX_ROWS + 1);
    } catch (e) {
      if (e instanceof CsvError) throw AppError.validation([{ field: 'file', message: `${e.message}. Up to ${EMPLOYEE_IMPORT_MAX_ROWS.toLocaleString('en')} employees can be imported at once.` }]);
      throw e;
    }
    if (table.length < 2) throw AppError.validation([{ field: 'file', message: 'The file has no employee rows. Download the template to see the expected columns.' }]);

    const header = table[0]!.map(normalizeHeader);
    const index = new Map<ColumnKey, number>();
    for (const c of COLUMNS) {
      const i = header.indexOf(c.header);
      if (i >= 0) index.set(c.key, i);
    }
    const missing = COLUMNS.filter((c) => 'required' in c && c.required && !index.has(c.key)).map((c) => c.header);
    if (missing.length) throw AppError.validation([{ field: 'file', message: `Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` }]);
    const known = new Set<string>(COLUMNS.map((c) => c.header));
    const ignoredColumns = table[0]!.filter((h, i) => h.trim() && !known.has(header[i]!));

    const lookups = await this.lookups();
    const issues: ImportIssue[] = [];
    let issueCount = 0;
    const issue = (row: number, column: string | null, message: string) => {
      issueCount++;
      if (issues.length < MAX_REPORTED_ERRORS) issues.push({ row, column, message });
    };

    const codeColumn = index.get('employeeCode');
    const allFileCodes = new Set(codeColumn === undefined ? [] : table.slice(1).map((cells) => (cells[codeColumn] ?? '').trim().toLowerCase()).filter(Boolean));
    const rows: ParsedRow[] = [];
    const fileCodes = new Map<string, number>();
    let invalidRows = 0;
    for (let r = 1; r < table.length; r++) {
      const line = r + 1;
      const cells = table[r]!;
      const get = (key: ColumnKey) => {
        const i = index.get(key);
        return i === undefined ? '' : (cells[i] ?? '').trim();
      };
      const before = issueCount;
      const values: Partial<Employee> = {};

      const firstName = get('firstName');
      const lastName = get('lastName');
      if (!firstName) issue(line, 'first_name', 'First name is required');
      else if (firstName.length > 100) issue(line, 'first_name', 'First name is longer than 100 characters');
      if (!lastName) issue(line, 'last_name', 'Last name is required');
      else if (lastName.length > 100) issue(line, 'last_name', 'Last name is longer than 100 characters');
      values.firstName = firstName;
      values.lastName = lastName;

      const code = get('employeeCode').toUpperCase() || null;
      if (code) {
        if (!CODE_PATTERN.test(code)) issue(line, 'employee_code', 'Use letters, numbers, -, _ and / (max 30)');
        else if (lookups.codes.has(code.toLowerCase())) issue(line, 'employee_code', `Employee code ${code} already exists`);
        else if (fileCodes.has(code.toLowerCase())) issue(line, 'employee_code', `Employee code ${code} is also used on row ${fileCodes.get(code.toLowerCase())}`);
        else fileCodes.set(code.toLowerCase(), line);
      }

      for (const [key, column] of [['workEmail', 'work_email'], ['personalEmail', 'personal_email']] as const) {
        const v = get(key).toLowerCase();
        if (v && (!isEmail(v) || v.length > 254)) issue(line, column, `"${v}" is not a valid email address`);
        values[key] = v || null;
      }
      const phone = get('phone');
      if (phone && !PHONE.test(phone)) issue(line, 'phone', `"${phone}" is not a valid phone number`);
      values.phone = phone || null;

      const dates: Record<'dateOfBirth' | 'dateOfJoining' | 'probationEndDate', string | null> = { dateOfBirth: null, dateOfJoining: null, probationEndDate: null };
      for (const [key, column] of [['dateOfBirth', 'date_of_birth'], ['dateOfJoining', 'date_of_joining'], ['probationEndDate', 'probation_end_date']] as const) {
        const v = get(key);
        if (!v) {
          if (key === 'dateOfJoining') issue(line, column, 'Date of joining is required');
        } else if (!isDate(v)) issue(line, column, `"${v}" is not a date; use YYYY-MM-DD`);
        else dates[key] = v;
      }
      values.dateOfBirth = dates.dateOfBirth;
      values.probationEndDate = dates.probationEndDate;
      if (dates.dateOfJoining) values.dateOfJoining = dates.dateOfJoining;
      if (values.dateOfBirth && values.dateOfBirth >= today()) issue(line, 'date_of_birth', 'Date of birth must be in the past');
      if (values.dateOfBirth && values.dateOfJoining && values.dateOfJoining <= values.dateOfBirth) issue(line, 'date_of_joining', 'Date of joining must be after the date of birth');
      if (values.probationEndDate && values.dateOfJoining && values.probationEndDate < values.dateOfJoining) issue(line, 'probation_end_date', 'Probation cannot end before the date of joining');

      const gender = get('gender');
      if (gender) {
        const g = GENDER_ALIASES[normalizeHeader(gender)];
        if (!g) issue(line, 'gender', `"${gender}" is not a gender; use MALE, FEMALE, NON_BINARY or UNDISCLOSED`);
        values.gender = g ?? null;
      }
      const type = get('employmentType');
      if (type) {
        const t = normalizeHeader(type).toUpperCase() as EmploymentType;
        if (!EMPLOYMENT_TYPES.includes(t)) issue(line, 'employment_type', `"${type}" is not an employment type; use ${EMPLOYMENT_TYPES.join(', ')}`);
        else values.employmentType = t;
      }
      const notice = get('noticePeriodDays');
      if (notice) {
        const n = Number(notice);
        if (!Number.isInteger(n) || n < 0 || n > 365) issue(line, 'notice_period_days', 'Notice period must be a whole number of days from 0 to 365');
        else values.noticePeriodDays = n;
      }

      for (const [key, column, label, field] of [
        ['department', 'department', 'Department', 'departmentId'],
        ['designation', 'designation', 'Designation', 'designationId'],
        ['location', 'location', 'Location', 'locationId'],
        ['grade', 'grade', 'Grade', 'gradeId'],
        ['costCenter', 'cost_center', 'Cost center', 'costCenterId'],
      ] as const) {
        const v = get(key);
        if (!v) continue;
        const found = lookups[key].get(v.toLowerCase());
        if (!found) issue(line, column, `${label} "${v}" does not exist. Add it under Administration → Structure first.`);
        else if (!found.isActive) issue(line, column, `${label} "${v}" is inactive`);
        else values[field] = found.id;
      }

      const managerCode = get('managerCode').toUpperCase() || null;
      if (managerCode && managerCode === code) issue(line, 'manager_code', 'An employee cannot be their own manager');
      else if (managerCode && !lookups.activeManagers.has(managerCode.toLowerCase()) && !allFileCodes.has(managerCode.toLowerCase())) {
        issue(line, 'manager_code', lookups.codes.has(managerCode.toLowerCase()) ? `Manager ${managerCode} has exited` : `No employee with code ${managerCode} (in the organization or this file)`);
      }

      if (issueCount === before) rows.push({ line, id: randomUUID(), employeeCode: code, managerCode, values });
      else invalidRows++;
    }

    const ordered = issueCount ? [] : this.managersFirst(rows, issue);
    if (issueCount && !invalidRows) invalidRows = 1;
    const total = table.length - 1;
    const result = { dryRun, total, valid: total - invalidRows, errorCount: issueCount, errors: issues, ignoredColumns, created: 0 };
    if (issueCount || dryRun) return result;

    const created = await this.commit(auth, ordered, lookups);
    return { ...result, created };
  }

  /** Orders rows so each manager from the file is created before their reports; reports reporting loops. */
  private managersFirst(rows: ParsedRow[], issue: (row: number, column: string | null, message: string) => void): ParsedRow[] {
    const byCode = new Map(rows.filter((r) => r.employeeCode).map((r) => [r.employeeCode!.toLowerCase(), r]));
    const state = new Map<ParsedRow, 'visiting' | 'done'>();
    const out: ParsedRow[] = [];
    let looped = false;
    const visit = (row: ParsedRow) => {
      const s = state.get(row);
      if (s === 'done') return;
      if (s === 'visiting') {
        if (!looped) issue(row.line, 'manager_code', 'These rows form a reporting loop (A reports to B who reports to A)');
        looped = true;
        return;
      }
      state.set(row, 'visiting');
      const manager = row.managerCode ? byCode.get(row.managerCode.toLowerCase()) : undefined;
      if (manager) visit(manager);
      state.set(row, 'done');
      out.push(row);
    };
    for (const row of rows) visit(row);
    return looped ? [] : out;
  }

  private async commit(auth: AuthContext, rows: ParsedRow[], lookups: Awaited<ReturnType<EmployeeImportService['lookups']>>): Promise<number> {
    let next = lookups.maxGeneratedCode;
    for (const row of rows) {
      if (!row.employeeCode) {
        do next++;
        while (lookups.codes.has(`emp-${String(next).padStart(4, '0')}`));
        row.employeeCode = `EMP-${String(next).padStart(4, '0')}`;
      }
    }
    const idByCode = new Map(rows.map((r) => [r.employeeCode!.toLowerCase(), r.id]));
    const organizationId = auth.organizationId!;
    try {
      await this.db.transaction(async (transaction) => {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          await Employee.bulkCreate(
            chunk.map((r) => ({
              ...r.values,
              id: r.id,
              organizationId,
              employeeCode: r.employeeCode!,
              firstName: r.values.firstName!,
              lastName: r.values.lastName!,
              dateOfJoining: r.values.dateOfJoining!,
              managerId: r.managerCode ? (idByCode.get(r.managerCode.toLowerCase()) ?? lookups.activeManagers.get(r.managerCode.toLowerCase())!) : null,
              createdById: auth.userId,
              updatedById: auth.userId,
            })),
            { transaction },
          );
          await EmployeeLifecycleEvent.bulkCreate(
            chunk.map((r) => ({ organizationId, employeeId: r.id, type: 'JOINED' as const, effectiveDate: r.values.dateOfJoining!, changes: {}, note: 'Imported from CSV', createdById: auth.userId })),
            { transaction },
          );
        }
        await this.audit.record(
          { action: 'employee.imported', entityType: 'Employee', summary: `${rows.length} employee${rows.length === 1 ? '' : 's'} imported from CSV`, metadata: { count: rows.length } },
          transaction,
        );
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('Some employee codes were taken while importing. Run the import again.');
      throw e;
    }
    return rows.length;
  }

  private async lookups() {
    const byNameOrCode = <T extends { id: string; name: string; isActive: boolean; code?: string | null }>(rows: T[]) => {
      const map = new Map<string, { id: string; isActive: boolean }>();
      for (const r of rows) {
        map.set(r.name.toLowerCase(), { id: r.id, isActive: r.isActive });
        if (r.code) map.set(r.code.toLowerCase(), { id: r.id, isActive: r.isActive });
      }
      return map;
    };
    const [departments, designations, locations, grades, costCenters, employees] = await Promise.all([
      Department.findAll({ attributes: ['id', 'name', 'code', 'isActive'] }),
      Designation.findAll({ attributes: ['id', 'name', 'isActive'] }),
      Location.findAll({ attributes: ['id', 'name', 'code', 'isActive'] }),
      Grade.findAll({ attributes: ['id', 'name', 'code', 'isActive'] }),
      CostCenter.findAll({ attributes: ['id', 'name', 'code', 'isActive'] }),
      Employee.findAll({ attributes: ['id', 'employeeCode', 'status'], raw: true }),
    ]);
    const codes = new Set(employees.map((e) => e.employeeCode.toLowerCase()));
    const activeManagers = new Map(employees.filter((e) => e.status !== 'EXITED').map((e) => [e.employeeCode.toLowerCase(), e.id]));
    const maxGeneratedCode = employees.reduce((m, e) => Math.max(m, Number(/^EMP-(\d+)$/i.exec(e.employeeCode)?.[1] ?? 0)), 0);
    return {
      department: byNameOrCode(departments),
      designation: byNameOrCode(designations),
      location: byNameOrCode(locations),
      grade: byNameOrCode(grades),
      costCenter: byNameOrCode(costCenters),
      codes,
      activeManagers,
      maxGeneratedCode,
    };
  }
}
