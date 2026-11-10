import { Injectable, Logger } from '@nestjs/common';
import { Op, type Model, type ModelStatic, type Transaction } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import {
  AlumniProfile,
  AttendanceOvertime,
  AttendanceRecord,
  AttendanceRegularization,
  BankDetailChange,
  BenefitEnrollment,
  BenefitEnrollmentDependent,
  Candidate,
  Employee,
  EmployeeDocument,
  EmployeeEducation,
  EmployeeExperience,
  EmployeeFamilyMember,
  EmployeeLifecycleEvent,
  EmployeeLoan,
  EmployeeSalary,
  EmployeeSkill,
  ExitCase,
  ExitLetter,
  GrievanceCase,
  JobApplication,
  LeaveLedgerEntry,
  LeaveRequest,
  LoginEvent,
  OrganizationMembership,
  Payslip,
  PolicyAcknowledgement,
  PrivacySettings,
  ReimbursementClaim,
  ShiftAssignment,
  TaxDeclarationRecord,
  Timesheet,
  TrainingEnrollment,
  User,
  UserAvatar,
  WorkFromHomeRequest,
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx, type EmployeeEncryptedColumn } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { SessionService } from '../auth/session.service';
import { fullName, organizationToday } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import type { PrivacySettingsDto } from './privacy.dto';

export const PRIVACY_DEFAULTS = { exitedRetentionYears: 8, candidateRetentionMonths: 12 };

/** Records about the person, by section; everything keyed by employee id goes in, minus storage keys and secrets. */
const EXPORT_SECTIONS: [string, ModelStatic<Model>][] = [
  ['lifecycleEvents', EmployeeLifecycleEvent],
  ['family', EmployeeFamilyMember],
  ['education', EmployeeEducation],
  ['experience', EmployeeExperience],
  ['documents', EmployeeDocument],
  ['skills', EmployeeSkill],
  ['attendance', AttendanceRecord],
  ['attendanceCorrections', AttendanceRegularization],
  ['overtime', AttendanceOvertime],
  ['workFromHome', WorkFromHomeRequest],
  ['timesheets', Timesheet],
  ['shiftAssignments', ShiftAssignment],
  ['leaveRequests', LeaveRequest],
  ['leaveLedger', LeaveLedgerEntry],
  ['salaries', EmployeeSalary],
  ['payslips', Payslip],
  ['taxDeclarations', TaxDeclarationRecord],
  ['reimbursements', ReimbursementClaim],
  ['loans', EmployeeLoan],
  ['training', TrainingEnrollment],
  ['benefits', BenefitEnrollment],
  ['policyAcknowledgements', PolicyAcknowledgement],
  ['exit', ExitCase],
  ['exitLetters', ExitLetter],
  ['alumni', AlumniProfile],
];
const NEVER_EXPORTED = /(encrypted|Enc$|storageKey|Key$|hash|^organizationId$)/i;

const SENSITIVE: [keyof Employee, EmployeeEncryptedColumn, string][] = [
  ['panEncrypted', 'pan', 'pan'],
  ['uanEncrypted', 'uan', 'uan'],
  ['bankAccountEncrypted', 'bank_account', 'bankAccountNumber'],
  ['aadhaarEncrypted', 'aadhaar', 'aadhaar'],
  ['passportEncrypted', 'passport', 'passportNumber'],
];
const CONTACT: [keyof Employee, EmployeeEncryptedColumn][] = [
  ['address', 'address'],
  ['permanentAddress', 'permanent_address'],
  ['emergencyContactName', 'emergency_contact_name'],
  ['emergencyContactPhone', 'emergency_contact_phone'],
];

const plain = (row: { get: (o: { plain: true }) => object }) =>
  Object.fromEntries(Object.entries(row.get({ plain: true })).filter(([k]) => !NEVER_EXPORTED.test(k)));

/**
 * Personal data under the DPDP Act 2023: a person's export of their data, erasure of former employees (partial within
 * the statutory retention period, full anonymization after it), and automatic anonymization of candidates who weren't
 * hired. Exports and erasures need a fresh step-up and are audited without the data itself.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly crypto: EncryptionService,
    private readonly storage: StorageService,
    private readonly sessions: SessionService,
  ) {}

  // ---- Settings ---------------------------------------------------------------------------------

  async settings(organizationId: string) {
    const s = await PrivacySettings.findByPk(organizationId);
    return {
      exitedRetentionYears: s?.exitedRetentionYears ?? PRIVACY_DEFAULTS.exitedRetentionYears,
      candidateRetentionMonths: s?.candidateRetentionMonths ?? PRIVACY_DEFAULTS.candidateRetentionMonths,
      candidatesPurgedAt: s?.candidatesPurgedAt ?? null,
    };
  }

  async updateSettings(auth: AuthContext, dto: PrivacySettingsDto) {
    const before = await this.settings(auth.organizationId!);
    await this.db.transaction(async (transaction) => {
      const row = await PrivacySettings.findByPk(auth.organizationId!, { transaction, lock: transaction.LOCK.UPDATE });
      const values = { ...dto, updatedById: auth.userId };
      if (row) await row.update(values, { transaction });
      else await PrivacySettings.create({ organizationId: auth.organizationId!, ...values }, { transaction });
      await this.audit.record(
        { action: 'privacy.settings_updated', entityType: 'PrivacySettings', summary: 'Data retention periods updated', changes: { exitedRetentionYears: { from: before.exitedRetentionYears, to: dto.exitedRetentionYears ?? before.exitedRetentionYears }, candidateRetentionMonths: { from: before.candidateRetentionMonths, to: dto.candidateRetentionMonths ?? before.candidateRetentionMonths } } },
        transaction,
      );
    });
    return this.overview(auth);
  }

  /** Settings plus what is due: former employees past the retention period and candidates to anonymize. */
  async overview(auth: AuthContext) {
    const settings = await this.settings(auth.organizationId!);
    const today = await organizationToday(auth.organizationId!);
    const exited = await Employee.findAll({
      where: { status: 'EXITED', [Op.or]: [{ erasureLevel: null }, { erasureLevel: 'PARTIAL' }] },
      attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'exitDate', 'erasedAt', 'erasureLevel'],
      order: [['exitDate', 'ASC']],
    });
    return {
      ...settings,
      formerEmployees: exited.map((e) => {
        const retainUntil = e.exitDate ? retentionEnd(e.exitDate, settings.exitedRetentionYears) : null;
        return {
          id: e.id,
          name: fullName(e),
          employeeCode: e.employeeCode,
          exitDate: e.exitDate,
          retainUntil,
          erasureLevel: e.erasureLevel,
          erasedAt: e.erasedAt,
          /** What erasing now would do. */
          nextErasure: retainUntil && retainUntil <= today ? ('FULL' as const) : ('PARTIAL' as const),
        };
      }),
      candidatesDue: settings.candidateRetentionMonths ? (await this.dueCandidates(settings.candidateRetentionMonths)).length : 0,
    };
  }

  // ---- Export -----------------------------------------------------------------------------------

  async exportMine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    const data = await this.collect(auth.userId, self?.id ?? null);
    await this.audit.record({ action: 'privacy.exported', entityType: 'User', entityId: auth.userId, summary: 'Personal data exported by the person themself' });
    return data;
  }

  async exportEmployee(auth: AuthContext, employeeId: string) {
    const employee = await this.findEmployee(auth, employeeId);
    const userId = employee.membershipId ? ((await OrganizationMembership.findByPk(employee.membershipId, { attributes: ['userId'] }))?.userId ?? null) : null;
    const data = await this.collect(userId, employee.id);
    await this.audit.record({ action: 'privacy.exported', entityType: 'Employee', entityId: employee.id, summary: `Personal data of ${employee.employeeCode} exported (data request)` });
    return data;
  }

  private async collect(userId: string | null, employeeId: string | null) {
    const user = userId ? await User.findByPk(userId, { attributes: ['id', 'email', 'firstName', 'lastName', 'phone', 'status', 'mfaEnabled', 'lastLoginAt', 'createdAt'] }) : null;
    const employee = employeeId ? await Employee.findByPk(employeeId) : null;
    const sections: Record<string, unknown[]> = {};
    if (employee) {
      for (const [name, model] of EXPORT_SECTIONS) {
        const rows = await model.findAll({ where: { employeeId: employee.id }, order: 'createdAt' in model.getAttributes() ? [['createdAt', 'ASC']] : undefined });
        if (rows.length) sections[name] = rows.map(plain);
      }
    }
    const logins = userId ? await LoginEvent.findAll({ where: { userId }, attributes: ['createdAt', 'outcome', 'ipAddress', 'userAgent'], order: [['createdAt', 'DESC']], limit: 200 }) : [];
    return {
      generatedAt: new Date().toISOString(),
      notice: 'Personal data held about you by this organization. Evaluations still in progress and other people’s confidential notes are not included.',
      account: user ? plain(user) : null,
      employee: employee ? this.employeeRecord(employee) : null,
      ...sections,
      recentSignIns: logins.map(plain),
    };
  }

  private employeeRecord(e: Employee) {
    const record = plain(e) as Record<string, unknown>;
    for (const [attr, column] of CONTACT) record[attr] = this.crypto.decryptLenient(e[attr] as string | null, ctx.employee(column, e.id));
    for (const [attr, column, name] of SENSITIVE) {
      const v = e[attr] as string | null;
      record[name] = v ? this.crypto.decrypt(v, ctx.employee(column, e.id)) : null;
    }
    return record;
  }

  // ---- Erasure ----------------------------------------------------------------------------------

  /**
   * Erases a former employee's personal data. Within the retention period only what the law doesn't require is removed
   * (contact details, family, education, documents, identity documents, bank account, photo); the name, PAN, UAN, salary
   * and payslips stay for statutory records. After the retention period the record is anonymized as well.
   */
  async eraseEmployee(auth: AuthContext, employeeId: string, confirm: string) {
    const employee = await this.findEmployee(auth, employeeId);
    if (employee.status !== 'EXITED') throw AppError.conflict('Only former employees can be erased. Record their exit first.');
    if (confirm.trim().toUpperCase() !== employee.employeeCode.toUpperCase()) throw AppError.validation([{ field: 'confirm', message: `Type the employee code (${employee.employeeCode}) to confirm` }]);
    const open = await GrievanceCase.count({ where: { [Op.or]: [{ complainantId: employee.id }, { respondentId: employee.id }], status: { [Op.notIn]: ['CLOSED', 'WITHDRAWN'] } } });
    if (open) throw AppError.conflict('A grievance involving this person is still open; its records must be kept until it is closed.');
    const settings = await this.settings(auth.organizationId!);
    const today = await organizationToday(auth.organizationId!);
    const full = !!employee.exitDate && retentionEnd(employee.exitDate, settings.exitedRetentionYears) <= today;
    if (employee.erasureLevel === 'FULL' || (employee.erasureLevel === 'PARTIAL' && !full)) throw AppError.conflict('This record has already been erased as far as the retention period allows');

    const membership = employee.membershipId ? await OrganizationMembership.findByPk(employee.membershipId, { attributes: ['id', 'userId'] }) : null;
    const documents = await EmployeeDocument.findAll({ where: { employeeId: employee.id }, attributes: ['id', 'storageKey'] });
    const photos = await AttendanceRecord.findAll({ where: { employeeId: employee.id, checkInPhotoKey: { [Op.ne]: null } }, attributes: ['id', 'checkInPhotoKey'] });
    await this.db.transaction(async (transaction) => {
      const where = { employeeId: employee.id };
      if (photos.length) await AttendanceRecord.update({ checkInPhotoKey: null }, { where: { id: photos.map((p) => p.id) }, transaction });
      const enrollments = await BenefitEnrollment.findAll({ where, attributes: ['id'], transaction });
      if (enrollments.length) await BenefitEnrollmentDependent.destroy({ where: { enrollmentId: enrollments.map((x) => x.id) }, transaction });
      for (const model of [EmployeeFamilyMember, EmployeeEducation, EmployeeExperience, EmployeeDocument, EmployeeSkill, AlumniProfile, BankDetailChange] as ModelStatic<Model>[]) {
        await model.destroy({ where, transaction });
      }
      await employee.update(
        {
          personalEmail: null,
          phone: null,
          address: null,
          permanentAddress: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          maritalStatus: null,
          bloodGroup: null,
          nationality: null,
          aadhaarEncrypted: null,
          aadhaarLast4: null,
          passportEncrypted: null,
          passportExpiry: null,
          bankAccountEncrypted: null,
          bankAccountLast4: null,
          bankIfsc: null,
          bankName: null,
          biometricCode: null,
          ...(full ? { firstName: 'Former', lastName: 'employee', workEmail: null, dateOfBirth: null, gender: null, panEncrypted: null, uanEncrypted: null } : {}),
          erasedAt: new Date(),
          erasureLevel: full ? 'FULL' : 'PARTIAL',
          updatedById: auth.userId,
        },
        { transaction },
      );
      if (membership) await this.eraseAccount(membership.userId, auth.organizationId!, transaction);
      await this.audit.record(
        { action: 'privacy.employee_erased', entityType: 'Employee', entityId: employee.id, summary: `Personal data of ${employee.employeeCode} erased (${full ? 'anonymized after the retention period' : 'statutory records kept until the retention period ends'})`, metadata: { level: full ? 'FULL' : 'PARTIAL', documents: documents.length } },
        transaction,
      );
    });
    await this.storage.deleteQuietly([...documents.map((d) => d.storageKey), ...photos.map((p) => p.checkInPhotoKey!)]);
    return { id: employee.id, erasureLevel: full ? ('FULL' as const) : ('PARTIAL' as const) };
  }

  /** Signs the person out everywhere; the account itself is anonymized when they belong to no other organization. */
  private async eraseAccount(userId: string, organizationId: string, transaction: Transaction) {
    await this.sessions.revokeAll(userId, 'personal data erased', {}, transaction);
    const elsewhere = await OrganizationMembership.count({ where: { userId, organizationId: { [Op.ne]: organizationId } }, transaction, skipTenantScope: true } as never);
    await OrganizationMembership.update({ status: 'SUSPENDED' }, { where: { userId, organizationId }, transaction });
    if (elsewhere) return;
    await UserAvatar.destroy({ where: { userId }, transaction });
    await User.update(
      { email: `erased-${userId}@erased.invalid`, firstName: 'Former', lastName: 'user', phone: null, passwordHash: null, status: 'DISABLED', avatarUrl: null, mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null },
      { where: { id: userId }, transaction },
    );
  }

  // ---- Candidates -------------------------------------------------------------------------------

  /** Candidates not hired, with no application or activity in the last `months` months, not yet anonymized. */
  private async dueCandidates(months: number, transaction?: Transaction) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const candidates = await Candidate.findAll({ where: { erasedAt: null, updatedAt: { [Op.lt]: cutoff } }, attributes: ['id', 'resumeKey'], transaction });
    if (!candidates.length) return [];
    const blocked = new Set(
      (
        await JobApplication.findAll({
          where: { candidateId: candidates.map((c) => c.id), [Op.or]: [{ stage: { [Op.notIn]: ['REJECTED', 'WITHDRAWN'] } }, { updatedAt: { [Op.gte]: cutoff } }] },
          attributes: ['candidateId'],
          transaction,
        })
      ).map((a) => a.candidateId),
    );
    return candidates.filter((c) => !blocked.has(c.id));
  }

  /** Anonymizes due candidates now (also run daily by the retention job). */
  async purgeCandidates(organizationId: string, actorUserId: string | null) {
    const { candidateRetentionMonths: months } = await this.settings(organizationId);
    if (!months) return { anonymized: 0 };
    const due = await this.dueCandidates(months);
    if (!due.length) return { anonymized: 0 };
    await this.db.transaction(async (transaction) => {
      const ids = due.map((c) => c.id);
      for (const id of ids) {
        await Candidate.update(
          {
            firstName: 'Former',
            lastName: 'candidate',
            email: `erased-${id}@erased.invalid`,
            phone: null,
            currentCompany: null,
            currentTitle: null,
            currentCtc: null,
            expectedCtc: null,
            location: null,
            linkedinUrl: null,
            notes: null,
            skills: [],
            resumeKey: null,
            resumeFileName: null,
            resumeContentType: null,
            resumeSize: null,
            erasedAt: new Date(),
          },
          { where: { id }, transaction },
        );
      }
      await JobApplication.update({ rejectionReason: null }, { where: { candidateId: ids }, transaction });
      await PrivacySettings.findOrCreate({ where: { organizationId }, defaults: { organizationId }, transaction });
      await PrivacySettings.update({ candidatesPurgedAt: new Date() }, { where: { organizationId }, transaction });
      await this.audit.record(
        { action: 'privacy.candidates_anonymized', entityType: 'Candidate', organizationId, actorUserId, summary: `${ids.length} candidate${ids.length === 1 ? '' : 's'} anonymized after the ${months}-month retention period`, metadata: { count: ids.length } },
        transaction,
      );
    });
    await this.storage.deleteQuietly(due.map((c) => c.resumeKey).filter((k): k is string => !!k));
    this.logger.log(`Organization ${organizationId}: ${due.length} candidates anonymized`);
    return { anonymized: due.length };
  }

  private async findEmployee(auth: AuthContext, id: string): Promise<Employee> {
    const employee = await Employee.findByPk(id);
    if (!employee) throw AppError.notFound('Employee');
    if (!(await this.scope.covers(auth, 'employee.view', employee))) throw AppError.notFound('Employee');
    return employee;
  }
}

/** The day statutory retention ends: the exit date plus the retention years. */
export function retentionEnd(exitDate: string, years: number): string {
  const [y, m, d] = exitDate.split('-').map(Number) as [number, number, number];
  const end = `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 29 February in a non-leap target year rolls to 1 March.
  return m === 2 && d === 29 && new Date(Date.UTC(y + years, 1, 29)).getUTCMonth() !== 1 ? addDays(`${y + years}-02-28`, 1) : end;
}
