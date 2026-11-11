import { Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import { DEFAULT_OFFER_LETTER, type DocumentContentType } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { zonedParts } from '../../common/utils/zoned-time';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import {
  ApplicationEvent,
  ApprovalInstance,
  Candidate,
  Department,
  Designation,
  Employee,
  EmployeeDocument,
  JobApplication,
  JobOpening,
  JobRequisition,
  LetterTemplate,
  Location,
  Offer,
  OfferDocument,
  Organization,
  User,
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { generateToken, sha256 } from '../../infrastructure/crypto/tokens';
import { MailService } from '../../infrastructure/mail/mail.service';
import { offerEmail } from '../../infrastructure/mail/templates';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { ApprovalChainsService } from '../approvals/approval-chains.service';
import { usersWithPermission } from '../employees/employee-people';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OnboardingCasesService } from '../onboarding/onboarding-cases.service';
import type { HireDto, LetterTemplateDto, OfferApprovalNoteDto, OfferDto, OfferResponseDto, PrejoiningDetailsDto, RejectOfferApprovalDto, UpdateOfferDto } from './dto/recruitment.dto';
import { offerLetterHtml, renderLetterBody, fillPlaceholders, unknownPlaceholders, type OfferLetterValues } from './offer-letter';

export type PrejoiningDetails = Omit<PrejoiningDetailsDto, never>;

const PORTAL_GRACE_DAYS = 30;
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

/**
 * Offers (recruitment.offer.manage): drafted for applications at the offer stage, approved when required
 * (recruitment.offer.approve, never by whoever drafted it), released with a letter from the organization's template —
 * frozen and hashed at release — and signed by the candidate through a private link, which then serves as the
 * pre-joining portal. Converting an accepted offer creates the employee record, so it also needs employee.create.
 * A configured OFFER approval chain (matched on CTC and department) makes approval required and decides it step by
 * step; its "manager" is the requisition's hiring manager.
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly onboarding: OnboardingCasesService,
    private readonly config: AppConfig,
    private readonly mail: MailService,
    private readonly crypto: EncryptionService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly chains: ApprovalChainsService,
  ) {}

  async create(auth: AuthContext, applicationId: string, dto: OfferDto) {
    const a = await JobApplication.findByPk(applicationId, {
      include: [
        { model: Candidate, attributes: ['id', 'firstName', 'lastName'] },
        { model: JobOpening, include: [{ model: JobRequisition }] },
      ],
    });
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
      // A changed offer needs approving again.
      const reset = o.approvalStatus === 'APPROVED' || o.approvalStatus === 'PENDING' ? { approvalStatus: 'NOT_REQUIRED' as const, approvedById: null, approvedAt: null } : {};
      await o.update({ ...rest, ...(annualCtc !== undefined ? { annualCtc: String(annualCtc) } : {}), ...reset, updatedById: auth.userId }, { transaction });
      await this.chains.cancel('OFFER', o.id, transaction);
      await this.audit.record({ action: 'offer.updated', entityType: 'JobApplication', entityId: o.applicationId, summary: 'Offer updated' }, transaction);
    });
    return this.get(id);
  }

  // ---- Approval --------------------------------------------------------------------------------

  /** Why the offer needs approval before release (null = it doesn't). */
  async approvalReason(o: Offer): Promise<string | null> {
    const [org, app] = await Promise.all([
      Organization.findByPk(o.organizationId, { attributes: ['offerApprovalRequired'] }),
      JobApplication.findByPk(o.applicationId, { attributes: ['id'], include: [{ model: JobOpening, attributes: ['id'], include: [{ model: JobRequisition, attributes: ['budgetMax'] }] }] }),
    ]);
    const budgetMax = app?.job?.requisition?.budgetMax;
    if (budgetMax !== null && budgetMax !== undefined && Number(o.annualCtc) > Number(budgetMax)) return `Above the requisition budget of ${inr(Number(budgetMax))}`;
    if (org?.offerApprovalRequired) return 'Your organization approves every offer before release';
    const chain = await this.chains.applies('OFFER', { amount: Number(o.annualCtc), departmentId: o.departmentId });
    if (chain) return `The "${chain.name}" approval chain applies`;
    return null;
  }

  async submitForApproval(auth: AuthContext, id: string) {
    const o = await this.find(id);
    if (o.status !== 'DRAFT') throw AppError.conflict(`This offer is ${o.status.toLowerCase()}`);
    if (o.approvalStatus === 'PENDING') throw AppError.conflict('This offer is already waiting for approval');
    const reason = await this.approvalReason(o);
    if (!reason) throw AppError.conflict("This offer doesn't need approval; release it");
    const candidate = await this.candidateOf(o);
    const app = await JobApplication.findByPk(o.applicationId, { attributes: ['id'], include: [{ model: JobOpening, attributes: ['id'], include: [{ model: JobRequisition, attributes: ['hiringManagerId'] }] }] });
    const drafter = auth.membershipId ? await Employee.findOne({ where: { membershipId: auth.membershipId }, attributes: ['id'] }) : null;
    await this.db.transaction(async (transaction) => {
      await o.update({ approvalStatus: 'PENDING', approvalRequestedAt: new Date(), approvalRequestedById: auth.userId, approvalNote: null, approvedById: null, approvedAt: null }, { transaction });
      await this.audit.record(
        { action: 'offer.approval_requested', entityType: 'JobApplication', entityId: o.applicationId, summary: `Approval requested for the offer to ${fullName(candidate)} (${reason})` },
        transaction,
      );
      // On a chain the requisition's hiring manager stands in as "the manager"; whoever sent it never approves.
      const requester = { id: drafter?.id ?? '', managerId: app?.job?.requisition?.hiringManagerId ?? null, departmentId: o.departmentId, membershipId: auth.membershipId ?? null };
      const chain = await this.chains.start('OFFER', o.id, requester, { amount: Number(o.annualCtc) }, transaction);
      const approvers = chain ? await this.chains.usersOf(chain.steps[0]!.approverMembershipIds, transaction) : await usersWithPermission('recruitment.offer.approve', transaction);
      for (const userId of approvers) {
        if (userId === o.createdById) continue;
        if (userId === auth.userId) continue;
        await this.notifications.notify(
          userId,
          {
            organizationId: auth.organizationId,
            type: 'recruitment.offer',
            title: `Offer for ${fullName(candidate)} (${inr(Number(o.annualCtc))}) needs your approval`,
            body: reason,
            link: chain ? '/me/approvals' : `/hr/recruitment/applications/${o.applicationId}`,
          },
          transaction,
        );
      }
    });
    return this.get(id);
  }

  async approve(auth: AuthContext, id: string, dto: OfferApprovalNoteDto) {
    const { offer: o, chain } = await this.forDecision(auth, id);
    let next: { approvers: string[]; label: string } | null = null;
    await this.db.transaction(async (transaction) => {
      if (chain) {
        const result = await this.chains.decide(auth, chain, 'APPROVED', dto.note ?? null, transaction);
        if (!result.final) {
          next = { approvers: result.nextApprovers, label: result.nextLabel! };
          await this.audit.record({ action: 'offer.step_approved', entityType: 'JobApplication', entityId: o.applicationId, summary: `Offer approved at this step; ${result.nextLabel} next` }, transaction);
          await this.tellRequester(o, `The offer was approved; ${result.nextLabel} approves next`, dto.note ?? undefined, auth, transaction);
          return;
        }
      }
      await o.update({ approvalStatus: 'APPROVED', approvedById: auth.userId, approvedAt: new Date(), approvalNote: dto.note ?? null }, { transaction });
      await this.audit.record({ action: 'offer.approved', entityType: 'JobApplication', entityId: o.applicationId, summary: 'Offer approved for release' }, transaction);
      await this.tellRequester(o, 'The offer was approved and can be released', dto.note ?? undefined, auth, transaction);
    });
    const pending = next as { approvers: string[]; label: string } | null;
    if (pending) {
      const candidate = await this.candidateOf(o);
      for (const userId of await this.chains.usersOf(pending.approvers)) {
        if (userId === auth.userId || userId === o.createdById) continue;
        await this.notifications.notify(userId, {
          organizationId: auth.organizationId,
          type: 'recruitment.offer',
          title: `${pending.label} approval needed: offer for ${fullName(candidate)} (${inr(Number(o.annualCtc))})`,
          link: '/me/approvals',
        });
      }
    }
    return this.get(id, auth);
  }

  async rejectApproval(auth: AuthContext, id: string, dto: RejectOfferApprovalDto) {
    const { offer: o, chain } = await this.forDecision(auth, id);
    await this.db.transaction(async (transaction) => {
      if (chain) await this.chains.decide(auth, chain, 'REJECTED', dto.note, transaction);
      await o.update({ approvalStatus: 'REJECTED', approvedById: auth.userId, approvedAt: new Date(), approvalNote: dto.note }, { transaction });
      await this.audit.record({ action: 'offer.approval_rejected', entityType: 'JobApplication', entityId: o.applicationId, summary: 'Offer approval rejected' }, transaction);
      await this.tellRequester(o, 'The offer was not approved', dto.note, auth, transaction);
    });
    return this.get(id, auth);
  }

  /** Offers waiting for this caller's decision: their chain step, or (without a chain) any pending offer they may approve. */
  async awaitingMe(auth: AuthContext) {
    this.requireModule(auth);
    const [mine, managed] = await Promise.all([this.chains.waitingFor(auth, 'OFFER'), this.chains.managedPending('OFFER')]);
    const legacy = auth.permissions.has('recruitment.offer.approve')
      ? (await Offer.findAll({ where: { approvalStatus: 'PENDING', status: 'DRAFT' }, attributes: ['id', 'createdById', 'approvalRequestedById'] }))
          .filter((o) => !managed.includes(o.id) && o.createdById !== auth.userId && o.approvalRequestedById !== auth.userId)
          .map((o) => o.id)
      : [];
    const ids = [...new Set([...mine, ...legacy])];
    if (!ids.length) return [];
    const offers = await Offer.findAll({ where: { id: ids }, include: [{ model: Designation, attributes: ['id', 'name'] }], order: [['approvalRequestedAt', 'ASC']] });
    const apps = await JobApplication.findAll({ where: { id: offers.map((o) => o.applicationId) }, attributes: ['id'], include: [{ model: Candidate, attributes: ['firstName', 'lastName'] }] });
    const candidate = new Map(apps.map((a) => [a.id, a.candidate ? fullName(a.candidate) : 'Candidate']));
    const chains = await this.chains.forMany('OFFER', ids);
    return offers.map((o) => ({
      id: o.id,
      applicationId: o.applicationId,
      candidate: candidate.get(o.applicationId) ?? 'Candidate',
      designation: o.designation?.name ?? null,
      annualCtc: Number(o.annualCtc),
      joiningDate: o.joiningDate,
      requestedAt: o.approvalRequestedAt,
      awaiting: chains.get(o.id)?.steps[chains.get(o.id)!.currentStep]?.label ?? null,
    }));
  }

  private requireModule(auth: AuthContext) {
    if (!auth.features.has('recruitment')) throw AppError.forbidden('Recruitment is not enabled for your organization');
  }

  private async forDecision(auth: AuthContext, id: string): Promise<{ offer: Offer; chain: ApprovalInstance | null }> {
    this.requireModule(auth);
    const o = await this.find(id);
    const instance = await this.chains.find('OFFER', id);
    const chain = instance?.status === 'PENDING' ? instance : null;
    if (chain) {
      const blocked = this.chains.blockReason(auth, chain);
      if (blocked) throw AppError.forbidden(blocked);
    } else if (!auth.permissions.has('recruitment.offer.approve')) throw AppError.forbidden();
    if (o.approvalStatus !== 'PENDING') throw AppError.conflict('This offer is not waiting for approval');
    if (o.createdById === auth.userId || o.approvalRequestedById === auth.userId) throw AppError.forbidden("You can't approve an offer you drafted or sent for approval");
    return { offer: o, chain };
  }

  /** HR handling offers, or someone on the offer's approval chain (who may hold no recruitment permission). */
  async readable(auth: AuthContext, id: string) {
    this.requireModule(auth);
    if (auth.permissions.has('recruitment.offer.manage') || auth.permissions.has('recruitment.offer.approve')) return;
    const chain = await this.chains.find('OFFER', id);
    if (chain && (this.chains.canDecide(auth, chain) || chain.decisions.some((d) => d.membershipId === auth.membershipId))) return;
    throw AppError.notFound('Offer');
  }

  private async tellRequester(o: Offer, title: string, body: string | undefined, auth: AuthContext, transaction: Transaction) {
    const to = o.approvalRequestedById ?? o.createdById;
    if (!to || to === auth.userId) return;
    await this.notifications.notify(to, { organizationId: auth.organizationId, type: 'recruitment.offer', title, body, link: `/hr/recruitment/applications/${o.applicationId}` }, transaction);
  }

  async saveSettings(auth: AuthContext, offerApprovalRequired: boolean) {
    await this.db.transaction(async (transaction) => {
      await Organization.update({ offerApprovalRequired }, { where: { id: auth.organizationId! }, transaction });
      await this.audit.record(
        {
          action: 'recruitment.settings_updated',
          entityType: 'Organization',
          entityId: auth.organizationId!,
          summary: `Offer approval ${offerApprovalRequired ? 'required' : 'only above the budget'}`,
        },
        transaction,
      );
    });
  }

  // ---- Letter ----------------------------------------------------------------------------------

  async letterTemplate() {
    const t = await LetterTemplate.findOne({ where: { kind: 'OFFER' } });
    return { subject: t?.subject ?? DEFAULT_OFFER_LETTER.subject, body: t?.body ?? DEFAULT_OFFER_LETTER.body, isDefault: !t, updatedAt: t?.updatedAt ?? null };
  }

  async saveLetterTemplate(auth: AuthContext, dto: LetterTemplateDto) {
    const unknown = unknownPlaceholders(`${dto.subject}\n${dto.body}`);
    if (unknown.length) throw AppError.validation([{ field: 'body', message: `Unknown placeholders: ${unknown.map((u) => `{{${u}}}`).join(', ')}` }]);
    await this.db.transaction(async (transaction) => {
      const existing = await LetterTemplate.findOne({ where: { kind: 'OFFER' }, transaction });
      if (existing) await existing.update({ subject: dto.subject, body: dto.body, updatedById: auth.userId }, { transaction });
      else await LetterTemplate.create({ organizationId: auth.organizationId!, kind: 'OFFER', subject: dto.subject, body: dto.body, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'offer.template_updated', entityType: 'LetterTemplate', summary: 'Offer letter template updated' }, transaction);
    });
    return this.letterTemplate();
  }

  /** The letter as released, or (for drafts) as it would be released today. */
  async letter(id: string): Promise<{ fileName: string; html: string }> {
    const o = await this.find(id);
    const html = o.letterHtml ?? (await this.renderLetter(o));
    return { fileName: `offer-letter-${o.id.slice(0, 8)}.html`, html };
  }

  private async renderLetter(o: Offer): Promise<string> {
    const [template, values] = await Promise.all([this.letterTemplate(), this.letterValues(o)]);
    return offerLetterHtml({
      subject: fillPlaceholders(template.subject, values),
      bodyHtml: renderLetterBody(template.body, values),
      organization: values.organization_name,
      releasedOn: values.today,
      reference: o.id.slice(0, 8).toUpperCase(),
    });
  }

  private async letterValues(o: Offer): Promise<OfferLetterValues> {
    const [org, app, designation, department, location, today] = await Promise.all([
      Organization.findByPk(o.organizationId, { attributes: ['name'] }),
      JobApplication.findByPk(o.applicationId, {
        include: [
          { model: Candidate, attributes: ['firstName', 'lastName'] },
          { model: JobOpening, attributes: ['id'], include: [{ model: JobRequisition, attributes: ['employmentType'] }] },
        ],
      }),
      o.designationId ? Designation.findByPk(o.designationId, { attributes: ['name'] }) : null,
      o.departmentId ? Department.findByPk(o.departmentId, { attributes: ['name'] }) : null,
      o.locationId ? Location.findByPk(o.locationId, { attributes: ['name'] }) : null,
      this.today(o.organizationId),
    ]);
    const c = app!.candidate!;
    return {
      candidate_name: fullName(c),
      candidate_first_name: c.firstName,
      designation: designation?.name ?? 'the role discussed',
      department: department?.name ?? 'our',
      location: location?.name ?? 'our office',
      employment_type: titleCase(app?.job?.requisition?.employmentType ?? 'FULL_TIME'),
      annual_ctc: inr(Number(o.annualCtc)),
      joining_date: longDate(o.joiningDate),
      offer_expiry: o.expiresOn ? longDate(o.expiresOn) : 'the date of joining',
      organization_name: org?.name ?? '',
      today: longDate(today),
    };
  }

  // ---- Release & candidate link ----------------------------------------------------------------

  async release(auth: AuthContext, id: string) {
    const o = await this.find(id);
    if (o.status !== 'DRAFT') throw AppError.conflict(`This offer is ${o.status.toLowerCase()}`);
    const today = await this.today(auth.organizationId!);
    if (o.joiningDate < today) throw AppError.validation([{ field: 'joiningDate', message: 'The joining date is in the past' }]);
    if (o.expiresOn && o.expiresOn < today) throw AppError.validation([{ field: 'expiresOn', message: 'The offer expiry date is in the past' }]);
    const reason = await this.approvalReason(o);
    if (reason && o.approvalStatus !== 'APPROVED') throw AppError.conflict(`${reason}: send it for approval first`);
    const html = await this.renderLetter(o);
    const token = generateToken();
    await this.db.transaction(async (transaction) => {
      await o.update(
        { status: 'RELEASED', releasedAt: new Date(), letterHtml: html, letterHash: sha256(html), portalTokenHash: sha256(token), portalExpiresAt: this.portalExpiry(o), updatedById: auth.userId },
        { transaction },
      );
      await this.audit.record({ action: 'offer.released', entityType: 'JobApplication', entityId: o.applicationId, summary: 'Offer released', metadata: { letterHash: sha256(html) } }, transaction);
    });
    const emailed = await this.sendLink(o, token);
    return { ...(await this.get(id)), portalUrl: this.portalUrl(token), emailed };
  }

  /** A new private link for the candidate (the old one stops working), emailed again. */
  async resendLink(auth: AuthContext, id: string) {
    const o = await this.find(id);
    if (!['RELEASED', 'ACCEPTED'].includes(o.status)) throw AppError.conflict('The candidate link is available for released or accepted offers');
    const token = generateToken();
    await this.db.transaction(async (transaction) => {
      await o.update({ portalTokenHash: sha256(token), portalExpiresAt: this.portalExpiry(o), updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'offer.link_reissued', entityType: 'JobApplication', entityId: o.applicationId, summary: 'Candidate offer link reissued' }, transaction);
    });
    const emailed = await this.sendLink(o, token);
    return { portalUrl: this.portalUrl(token), emailed };
  }

  private portalExpiry(o: Offer) {
    return new Date(Date.parse(`${o.joiningDate}T23:59:59Z`) + PORTAL_GRACE_DAYS * 86_400_000);
  }

  private portalUrl(token: string) {
    return `${this.config.get('APP_URL')}/offer/${encodeURIComponent(token)}`;
  }

  private async sendLink(o: Offer, token: string): Promise<boolean> {
    const candidate = await this.candidateOf(o, ['firstName', 'lastName', 'email']);
    const [org, designation] = await Promise.all([
      Organization.findByPk(o.organizationId, { attributes: ['name'] }),
      o.designationId ? Designation.findByPk(o.designationId, { attributes: ['name'] }) : null,
    ]);
    if (!candidate.email) return false;
    try {
      // The link carries the token, so it's sent now rather than stored in the job queue.
      await this.mail.send(offerEmail(candidate.email, candidate.firstName, org?.name ?? '', designation?.name ?? null, this.portalUrl(token), o.expiresOn ? longDate(o.expiresOn) : null));
      return true;
    } catch (e) {
      this.logger.warn(`Offer link for ${o.id} could not be emailed: ${(e as Error).message}`);
      return false;
    }
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
      `Offer ${dto.response.toLowerCase()} by the candidate (recorded by HR)`,
    );
    return this.get(id);
  }

  async withdraw(auth: AuthContext, id: string) {
    const o = await this.find(id);
    if (!['DRAFT', 'RELEASED', 'ACCEPTED'].includes(o.status)) throw AppError.conflict(`This offer is ${o.status.toLowerCase()}`);
    const app = await JobApplication.findByPk(o.applicationId, { attributes: ['id', 'stage'] });
    if (app?.stage === 'HIRED') throw AppError.conflict('The candidate has already been hired');
    await this.transition(auth, o, { status: 'WITHDRAWN', portalTokenHash: null }, 'offer.withdrawn', 'Offer withdrawn');
    await this.chains.cancel('OFFER', o.id);
    return this.get(id);
  }

  // ---- Pre-joining (HR view) -------------------------------------------------------------------

  /** What the candidate submitted before joining (decrypted; audited). */
  async prejoining(id: string) {
    const o = await this.find(id);
    const details = this.readPrejoining(o);
    const documents = await OfferDocument.findAll({ where: { offerId: id }, order: [['createdAt', 'ASC']] });
    if (details) await this.audit.record({ action: 'offer.prejoining_viewed', entityType: 'JobApplication', entityId: o.applicationId, summary: 'Pre-joining details viewed' });
    return {
      submittedAt: o.prejoiningSubmittedAt,
      details: details ? { ...details, pan: details.pan ? `••••••${details.pan.slice(-4)}` : null } : null,
      documents: documents.map((d) => ({ id: d.id, category: d.category, title: d.title, fileName: d.fileName, size: d.byteSize, uploadedAt: d.createdAt })),
    };
  }

  async prejoiningDocument(id: string, documentId: string): Promise<{ stream: Readable; fileName: string; contentType: string; size: number }> {
    const d = await OfferDocument.findOne({ where: { id: documentId, offerId: id } });
    if (!d) throw AppError.notFound('Document');
    await this.audit.record({ action: 'offer.prejoining_document_viewed', entityType: 'OfferDocument', entityId: d.id, summary: `Pre-joining document "${d.title}" opened` });
    return { stream: await this.storage.get(d.storageKey), fileName: d.fileName, contentType: d.contentType, size: d.byteSize };
  }

  readPrejoining(o: Offer): PrejoiningDetails | null {
    if (!o.prejoiningEncrypted) return null;
    return JSON.parse(this.crypto.decrypt(o.prejoiningEncrypted, fields.offerPrejoining(o.id))) as PrejoiningDetails;
  }

  // ---- Hire ------------------------------------------------------------------------------------

  /** Creates the employee from an accepted offer (with the pre-joining details and documents), marks the application hired and fills the requisition. */
  async hire(auth: AuthContext, id: string, dto: HireDto) {
    const o = await this.find(id);
    if (o.status !== 'ACCEPTED') throw AppError.conflict('Only accepted offers can be converted to an employee');
    const a = await JobApplication.findByPk(o.applicationId, { include: [{ model: Candidate }, { model: JobOpening, include: [{ model: JobRequisition }] }] });
    if (!a) throw AppError.notFound('Application');
    if (a.stage === 'HIRED') throw AppError.conflict('This candidate has already been hired');
    const c = a.candidate!;
    const req = a.job!.requisition!;
    const manager = req.hiringManagerId ? await Employee.findOne({ where: { id: req.hiringManagerId, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id'] }) : null;
    const p = this.readPrejoining(o);

    const employee = await this.employees.create(auth, {
      employeeCode: dto.employeeCode ?? null,
      firstName: c.firstName,
      lastName: c.lastName,
      personalEmail: c.email,
      phone: p?.phone ?? c.phone,
      dateOfJoining: o.joiningDate,
      employmentType: req.employmentType,
      departmentId: o.departmentId,
      designationId: o.designationId,
      locationId: o.locationId,
      managerId: manager?.id ?? null,
      noticePeriodDays: null,
      dateOfBirth: p?.dateOfBirth ?? null,
      gender: p?.gender ?? null,
      address: p?.address ?? null,
      permanentAddress: p?.permanentAddress ?? null,
      emergencyContactName: p?.emergencyContactName ?? null,
      emergencyContactPhone: p?.emergencyContactPhone ?? null,
      maritalStatus: p?.maritalStatus ?? null,
      bloodGroup: p?.bloodGroup ?? null,
      nationality: p?.nationality ?? null,
    });

    try {
      await this.db.transaction(async (transaction) => {
        await a.update({ stage: 'HIRED', stageChangedAt: new Date(), hiredEmployeeId: employee.id }, { transaction });
        await ApplicationEvent.create(
          { organizationId: auth.organizationId!, applicationId: a.id, fromStage: 'OFFER', toStage: 'HIRED', note: `Employee ${employee.employeeCode} created`, createdById: auth.userId },
          { transaction },
        );
        const hired = req.hiredCount + 1;
        await JobRequisition.update({ hiredCount: hired, ...(hired >= req.openings ? { status: 'FILLED' as const } : {}) }, { where: { id: req.id }, transaction });
        if (hired >= req.openings) await JobOpening.update({ status: 'CLOSED', closedAt: new Date() }, { where: { id: a.jobId }, transaction });
        if (p?.pan) await Employee.update({ panEncrypted: this.crypto.encrypt(p.pan, fields.employee('pan', employee.id)) }, { where: { id: employee.id }, transaction });
        // Documents move to the employee as unverified, keeping the stored files.
        const documents = await OfferDocument.findAll({ where: { offerId: o.id }, transaction });
        for (const d of documents) {
          await EmployeeDocument.create(
            {
              organizationId: auth.organizationId!,
              employeeId: employee.id,
              category: d.category,
              title: d.title,
              fileName: d.fileName,
              contentType: d.contentType as DocumentContentType,
              byteSize: d.byteSize,
              checksum: d.checksum,
              storageKey: d.storageKey,
              status: 'PENDING',
              createdById: auth.userId,
              updatedById: auth.userId,
            },
            { transaction },
          );
        }
        if (documents.length) await OfferDocument.destroy({ where: { offerId: o.id }, transaction });
        await o.update({ portalTokenHash: null }, { transaction });
        await this.audit.record(
          {
            action: 'candidate.hired',
            entityType: 'JobApplication',
            entityId: a.id,
            summary: `${fullName(c)} hired as ${employee.employeeCode}`,
            metadata: { employeeId: employee.id, offerId: o.id, documents: documents.length, prejoining: !!p },
          },
          transaction,
        );
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

  private async candidateOf(o: Offer, attributes: string[] = ['firstName', 'lastName']): Promise<Candidate> {
    const app = await JobApplication.findByPk(o.applicationId, { attributes: ['id'], include: [{ model: Candidate, attributes }] });
    return app!.candidate!;
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

  async get(id: string, auth?: AuthContext) {
    const o = await Offer.findByPk(id, {
      include: [
        { model: Designation, attributes: ['id', 'name'] },
        { model: Department, attributes: ['id', 'name'] },
        { model: Location, attributes: ['id', 'name'] },
      ],
    });
    if (!o) throw AppError.notFound('Offer');
    const ref = (r: { id: string; name: string } | null | undefined) => (r ? { id: r.id, name: r.name } : null);
    const people = [o.approvedById, o.approvalRequestedById, o.createdById].filter((x): x is string => !!x);
    const users = people.length ? new Map((await User.findAll({ where: { id: people }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)])) : new Map<string, string>();
    const documents = await OfferDocument.count({ where: { offerId: o.id } });
    const chain = await this.chains.find('OFFER', o.id);
    const onChain = chain?.status === 'PENDING' && o.approvalStatus === 'PENDING';
    const mineToDecide = !!auth && o.approvalStatus === 'PENDING' && o.createdById !== auth.userId && o.approvalRequestedById !== auth.userId;
    const canDecide = mineToDecide && (onChain ? this.chains.canDecide(auth, chain) : auth.permissions.has('recruitment.offer.approve'));
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
      createdById: o.createdById,
      approval: {
        status: o.approvalStatus,
        required: o.status === 'DRAFT' ? await this.approvalReason(o) : null,
        requestedBy: o.approvalRequestedById ? (users.get(o.approvalRequestedById) ?? null) : null,
        requestedAt: o.approvalRequestedAt,
        decidedBy: o.approvedById ? (users.get(o.approvedById) ?? null) : null,
        decidedAt: o.approvedAt,
        note: o.approvalNote,
        canDecide,
        chain: this.chains.present(o.approvalStatus === 'NOT_REQUIRED' ? null : chain),
      },
      signature: o.signedAt ? { name: o.signedName, at: o.signedAt, ip: o.signedIp, letterHash: o.letterHash } : null,
      portal: { active: !!o.portalTokenHash && !!o.portalExpiresAt && o.portalExpiresAt > new Date(), expiresAt: o.portalExpiresAt },
      prejoining: { submittedAt: o.prejoiningSubmittedAt, documents },
    };
  }
}
