import { Injectable, Logger } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { ApplicationEvent, Candidate, Department, Designation, Employee, JobApplication, JobOpening, JobRequisition, Location, Offer, Organization } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { OnboardingCasesService } from '../onboarding/onboarding-cases.service';
import type { HireDto, OfferDto, OfferResponseDto, UpdateOfferDto } from './dto/recruitment.dto';

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();

/**
 * Offers (recruitment.offer.manage): drafted for applications at the offer stage, released, then accepted or declined.
 * Converting an accepted offer creates the employee record, so it also needs employee.create.
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly onboarding: OnboardingCasesService,
  ) {}

  async create(auth: AuthContext, applicationId: string, dto: OfferDto) {
    const a = await JobApplication.findByPk(applicationId, { include: [{ model: Candidate, attributes: ['id', 'firstName', 'lastName'] }, { model: JobOpening, include: [{ model: JobRequisition }] }] });
    if (!a) throw AppError.notFound('Application');
    if (a.stage !== 'OFFER') throw AppError.conflict('Move the candidate to the offer stage first');
    const req = a.job!.requisition!;
    await this.validate({ ...dto, departmentId: dto.departmentId ?? req.departmentId, designationId: dto.designationId ?? req.designationId, locationId: dto.locationId ?? req.locationId });
    try {
      const offer = await this.db.transaction(async (transaction) => {
        const created = await Offer.create(
          {
            organizationId: auth.organizationId!,
            applicationId,
            designationId: dto.designationId ?? req.designationId,
            departmentId: dto.departmentId ?? req.departmentId,
            locationId: dto.locationId ?? req.locationId,
            annualCtc: String(dto.annualCtc),
            joiningDate: dto.joiningDate,
            expiresOn: dto.expiresOn ?? null,
            notes: dto.notes ?? null,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record({ action: 'offer.created', entityType: 'JobApplication', entityId: applicationId, summary: `Offer drafted for ${fullName(a.candidate!)}` }, transaction);
        return created;
      });
      return this.get(offer.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('This application already has an open offer');
      throw e;
    }
  }

  async update(auth: AuthContext, id: string, dto: UpdateOfferDto) {
    const o = await this.find(id);
    if (o.status !== 'DRAFT') throw AppError.conflict('Only draft offers can be changed; withdraw and create a new one');
    await this.validate({ ...this.plain(o), ...dto });
    await this.db.transaction(async (transaction) => {
      const { annualCtc, ...rest } = dto;
      await o.update({ ...rest, ...(annualCtc !== undefined ? { annualCtc: String(annualCtc) } : {}), updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'offer.updated', entityType: 'JobApplication', entityId: o.applicationId, summary: 'Offer updated' }, transaction);
    });
    return this.get(id);
  }

  async release(auth: AuthContext, id: string) {
    const o = await this.find(id);
    if (o.status !== 'DRAFT') throw AppError.conflict(`This offer is ${o.status.toLowerCase()}`);
    const today = await this.today(auth.organizationId!);
    if (o.joiningDate < today) throw AppError.validation([{ field: 'joiningDate', message: 'The joining date is in the past' }]);
    if (o.expiresOn && o.expiresOn < today) throw AppError.validation([{ field: 'expiresOn', message: 'The offer expiry date is in the past' }]);
    await this.transition(auth, o, { status: 'RELEASED', releasedAt: new Date() }, 'offer.released', 'Offer released');
    return this.get(id);
  }

  async respond(auth: AuthContext, id: string, dto: OfferResponseDto) {
    const o = await this.find(id);
    if (o.status !== 'RELEASED') throw AppError.conflict('Only released offers can be accepted or declined');
    if (dto.response === 'ACCEPTED' && o.expiresOn && o.expiresOn < (await this.today(auth.organizationId!))) throw AppError.conflict('This offer has expired; withdraw it and release a new one');
    await this.transition(
      auth,
      o,
      { status: dto.response, respondedAt: new Date(), declineReason: dto.response === 'DECLINED' ? (dto.reason ?? null) : null },
      `offer.${dto.response.toLowerCase()}`,
      `Offer ${dto.response.toLowerCase()} by the candidate`,
    );
    return this.get(id);
  }

  async withdraw(auth: AuthContext, id: string) {
    const o = await this.find(id);
    if (!['DRAFT', 'RELEASED', 'ACCEPTED'].includes(o.status)) throw AppError.conflict(`This offer is ${o.status.toLowerCase()}`);
    const app = await JobApplication.findByPk(o.applicationId, { attributes: ['id', 'stage'] });
    if (app?.stage === 'HIRED') throw AppError.conflict('The candidate has already been hired');
    await this.transition(auth, o, { status: 'WITHDRAWN' }, 'offer.withdrawn', 'Offer withdrawn');
    return this.get(id);
  }

  /** Creates the employee from an accepted offer, marks the application hired and fills the requisition. */
  async hire(auth: AuthContext, id: string, dto: HireDto) {
    const o = await this.find(id);
    if (o.status !== 'ACCEPTED') throw AppError.conflict('Only accepted offers can be converted to an employee');
    const a = await JobApplication.findByPk(o.applicationId, { include: [{ model: Candidate }, { model: JobOpening, include: [{ model: JobRequisition }] }] });
    if (!a) throw AppError.notFound('Application');
    if (a.stage === 'HIRED') throw AppError.conflict('This candidate has already been hired');
    const c = a.candidate!;
    const req = a.job!.requisition!;
    const manager = req.hiringManagerId ? await Employee.findOne({ where: { id: req.hiringManagerId, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id'] }) : null;

    const employee = await this.employees.create(auth, {
      employeeCode: dto.employeeCode ?? null,
      firstName: c.firstName,
      lastName: c.lastName,
      personalEmail: c.email,
      phone: c.phone,
      dateOfJoining: o.joiningDate,
      employmentType: req.employmentType,
      departmentId: o.departmentId,
      designationId: o.designationId,
      locationId: o.locationId,
      managerId: manager?.id ?? null,
      noticePeriodDays: null,
    });

    try {
      await this.db.transaction(async (transaction) => {
        await a.update({ stage: 'HIRED', stageChangedAt: new Date(), hiredEmployeeId: employee.id }, { transaction });
        await ApplicationEvent.create({ organizationId: auth.organizationId!, applicationId: a.id, fromStage: 'OFFER', toStage: 'HIRED', note: `Employee ${employee.employeeCode} created`, createdById: auth.userId }, { transaction });
        const hired = req.hiredCount + 1;
        await JobRequisition.update({ hiredCount: hired, ...(hired >= req.openings ? { status: 'FILLED' as const } : {}) }, { where: { id: req.id }, transaction });
        if (hired >= req.openings) await JobOpening.update({ status: 'CLOSED', closedAt: new Date() }, { where: { id: a.jobId }, transaction });
        await this.audit.record({ action: 'candidate.hired', entityType: 'JobApplication', entityId: a.id, summary: `${fullName(c)} hired as ${employee.employeeCode}`, metadata: { employeeId: employee.id, offerId: o.id } }, transaction);
      });
    } catch (e) {
      // Keep the data consistent: without the hire record the new employee must not remain.
      await this.employees.remove(auth, employee.id).catch((err: Error) => this.logger.error(`Could not undo employee ${employee.id}: ${err.message}`));
      throw e;
    }

    let onboardingCaseId: string | null = null;
    let onboardingError: string | null = null;
    if (dto.startOnboarding) {
      if (!auth.features.has('onboarding') || !auth.permissions.has('onboarding.manage')) onboardingError = 'Onboarding was not started: it needs the Onboarding module and onboarding permissions.';
      else {
        try {
          onboardingCaseId = (await this.onboarding.start(auth, { employeeId: employee.id })).id;
        } catch (e) {
          onboardingError = e instanceof AppError ? e.message : 'Onboarding could not be started';
        }
      }
    }
    return { employeeId: employee.id, employeeCode: employee.employeeCode, onboardingCaseId, onboardingError };
  }

  // ---------------------------------------------------------------------------------------------

  private async transition(auth: AuthContext, o: Offer, values: Partial<Offer>, action: string, summary: string) {
    await this.db.transaction(async (transaction) => {
      await o.update({ ...values, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action, entityType: 'JobApplication', entityId: o.applicationId, summary }, transaction);
    });
  }

  private async validate(dto: Partial<OfferDto>) {
    const issues = [];
    if (dto.expiresOn && dto.joiningDate && dto.expiresOn > dto.joiningDate) issues.push({ field: 'expiresOn', message: 'The offer should expire before the joining date' });
    const checks: [keyof OfferDto, () => Promise<unknown>][] = [
      ['departmentId', () => Department.findByPk(dto.departmentId!, { attributes: ['id'] })],
      ['designationId', () => Designation.findByPk(dto.designationId!, { attributes: ['id'] })],
      ['locationId', () => Location.findByPk(dto.locationId!, { attributes: ['id'] })],
    ];
    for (const [field, load] of checks) if (dto[field] && !(await load())) issues.push({ field, message: `${field.replace('Id', '')} not found` });
    if (issues.length) throw AppError.validation(issues);
  }

  private plain(o: Offer): Partial<OfferDto> {
    return { departmentId: o.departmentId, designationId: o.designationId, locationId: o.locationId, joiningDate: o.joiningDate, expiresOn: o.expiresOn };
  }

  private async find(id: string): Promise<Offer> {
    const o = await Offer.findByPk(id);
    if (!o) throw AppError.notFound('Offer');
    return o;
  }

  private async today(organizationId: string): Promise<string> {
    const org = await Organization.findByPk(organizationId, { attributes: ['timezone'] });
    return zonedParts(new Date(), org?.timezone ?? 'UTC').date;
  }

  async get(id: string) {
    const o = await Offer.findByPk(id, { include: [{ model: Designation, attributes: ['id', 'name'] }, { model: Department, attributes: ['id', 'name'] }, { model: Location, attributes: ['id', 'name'] }] });
    if (!o) throw AppError.notFound('Offer');
    const ref = (r: { id: string; name: string } | null | undefined) => (r ? { id: r.id, name: r.name } : null);
    return {
      id: o.id,
      applicationId: o.applicationId,
      status: o.status,
      annualCtc: Number(o.annualCtc),
      joiningDate: o.joiningDate,
      expiresOn: o.expiresOn,
      notes: o.notes,
      designation: ref(o.designation),
      department: ref(o.department),
      location: ref(o.location),
      releasedAt: o.releasedAt,
      respondedAt: o.respondedAt,
      declineReason: o.declineReason,
      createdAt: o.createdAt,
    };
  }
}
