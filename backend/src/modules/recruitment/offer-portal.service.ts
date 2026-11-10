import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PREJOINING_MAX_DOCUMENTS, RESUME_MAX_BYTES } from '../../contracts';
import { RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Candidate, Designation, JobApplication, Location, Offer, OfferDocument, Organization } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { sha256 } from '../../infrastructure/crypto/tokens';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { detectDocumentType, safeFileName } from '../employees/employee-documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { PortalAcceptDto, PortalDeclineDto, PortalDocumentDto, PrejoiningDetailsDto } from './dto/recruitment.dto';
import type { UploadedResume } from './candidates.service';
import { OffersService } from './offers.service';

const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The candidate's side of an offer, reached only through the private link emailed at release (no account): read the
 * letter, sign it by typing their name (time, IP, browser and the letter's SHA-256 are kept) or decline, and — once
 * accepted, until they're hired — share personal details and documents for joining.
 */
@Injectable()
export class OfferPortalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly crypto: EncryptionService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly offers: OffersService,
  ) {}

  async view(token: string) {
    return this.withOffer(token, async (o, org) => {
      const [app, designation, location, documents] = await Promise.all([
        JobApplication.findByPk(o.applicationId, { attributes: ['id', 'stage'], include: [{ model: Candidate, attributes: ['firstName', 'lastName'] }] }),
        o.designationId ? Designation.findByPk(o.designationId, { attributes: ['name'] }) : null,
        o.locationId ? Location.findByPk(o.locationId, { attributes: ['name'] }) : null,
        OfferDocument.findAll({ where: { offerId: o.id }, order: [['createdAt', 'ASC']] }),
      ]);
      const today = zonedParts(new Date(), org.timezone ?? 'UTC').date;
      const details = this.offers.readPrejoining(o);
      const hired = app?.stage === 'HIRED';
      return {
        organization: { name: org.name, logoUrl: org.logoUrl, brandColor: org.brandColor },
        candidate: { name: fullName(app!.candidate!), firstName: app!.candidate!.firstName },
        offer: {
          status: o.status,
          designation: designation?.name ?? null,
          location: location?.name ?? null,
          joiningDate: o.joiningDate,
          expiresOn: o.expiresOn,
          expired: !!o.expiresOn && o.expiresOn < today,
        },
        letterHtml: o.letterHtml,
        signature: o.signedAt ? { name: o.signedName, at: o.signedAt, letterHash: o.letterHash } : null,
        canRespond: o.status === 'RELEASED' && !(o.expiresOn && o.expiresOn < today),
        prejoining: {
          open: o.status === 'ACCEPTED' && !hired,
          hired,
          submittedAt: o.prejoiningSubmittedAt,
          details: details ? { ...details, pan: details.pan ? `••••••${details.pan.slice(-4)}` : null, hasPan: !!details.pan } : null,
          documents: documents.map((d) => ({ id: d.id, category: d.category, title: d.title, fileName: d.fileName, size: d.byteSize })),
          maxDocuments: PREJOINING_MAX_DOCUMENTS,
        },
      };
    });
  }

  async accept(token: string, dto: PortalAcceptDto, ip: string | undefined, userAgent: string | undefined) {
    return this.withOffer(token, async (o, org) => {
      if (o.status !== 'RELEASED') throw AppError.conflict(`This offer is already ${o.status.toLowerCase()}`);
      const today = zonedParts(new Date(), org.timezone ?? 'UTC').date;
      if (o.expiresOn && o.expiresOn < today) throw AppError.conflict('This offer has expired. Contact the recruiter.');
      if (!dto.agree) throw AppError.validation([{ field: 'agree', message: 'Confirm that you agree to sign electronically' }]);
      const app = await JobApplication.findByPk(o.applicationId, { attributes: ['id'], include: [{ model: Candidate, attributes: ['firstName', 'lastName'] }] });
      const name = fullName(app!.candidate!);
      if (normalize(dto.signedName) !== normalize(name)) throw AppError.validation([{ field: 'signedName', message: `Type your full name as it appears on the offer: ${name}` }]);
      // The letter signed is the one frozen at release; its hash is recorded with the signature.
      if (!o.letterHtml || createHash('sha256').update(o.letterHtml).digest('hex') !== o.letterHash) throw AppError.conflict('The offer letter could not be verified. Contact the recruiter.');
      await this.db.transaction(async (transaction) => {
        await o.update(
          {
            status: 'ACCEPTED',
            respondedAt: new Date(),
            signedName: dto.signedName.trim(),
            signedAt: new Date(),
            signedIp: ip?.slice(0, 64) ?? null,
            signedUserAgent: userAgent?.slice(0, 300) ?? null,
          },
          { transaction },
        );
        await this.audit.record(
          {
            action: 'offer.signed',
            entityType: 'JobApplication',
            entityId: o.applicationId,
            actorUserId: null,
            summary: `Offer accepted and signed by ${name}`,
            metadata: { letterHash: o.letterHash },
          },
          transaction,
        );
        if (o.createdById) {
          await this.notifications.notify(
            o.createdById,
            {
              organizationId: o.organizationId,
              type: 'recruitment.offer',
              title: `${name} accepted and signed the offer`,
              body: `Joining on ${o.joiningDate}.`,
              link: `/hr/recruitment/applications/${o.applicationId}`,
            },
            transaction,
          );
        }
      });
      return this.view(token);
    });
  }

  async decline(token: string, dto: PortalDeclineDto) {
    return this.withOffer(token, async (o) => {
      if (o.status !== 'RELEASED') throw AppError.conflict(`This offer is already ${o.status.toLowerCase()}`);
      const app = await JobApplication.findByPk(o.applicationId, { attributes: ['id'], include: [{ model: Candidate, attributes: ['firstName', 'lastName'] }] });
      const name = fullName(app!.candidate!);
      await this.db.transaction(async (transaction) => {
        await o.update({ status: 'DECLINED', respondedAt: new Date(), declineReason: dto.reason ?? null }, { transaction });
        await this.audit.record({ action: 'offer.declined', entityType: 'JobApplication', entityId: o.applicationId, actorUserId: null, summary: `Offer declined by ${name}` }, transaction);
        if (o.createdById) {
          await this.notifications.notify(
            o.createdById,
            {
              organizationId: o.organizationId,
              type: 'recruitment.offer',
              title: `${name} declined the offer`,
              body: dto.reason ?? undefined,
              link: `/hr/recruitment/applications/${o.applicationId}`,
            },
            transaction,
          );
        }
      });
      return this.view(token);
    });
  }

  async saveDetails(token: string, dto: PrejoiningDetailsDto) {
    return this.withOffer(token, async (o) => {
      await this.assertPrejoiningOpen(o);
      const previous = this.offers.readPrejoining(o);
      // An omitted PAN keeps the one given before (it's shown masked, never sent back).
      const details = { ...dto, pan: dto.pan === undefined ? (previous?.pan ?? null) : dto.pan };
      await this.db.transaction(async (transaction) => {
        await o.update({ prejoiningEncrypted: this.crypto.encrypt(JSON.stringify(details), fields.offerPrejoining(o.id)), prejoiningSubmittedAt: new Date() }, { transaction });
        await this.audit.record(
          { action: 'offer.prejoining_submitted', entityType: 'JobApplication', entityId: o.applicationId, actorUserId: null, summary: 'Pre-joining details submitted by the candidate' },
          transaction,
        );
      });
      return this.view(token);
    });
  }

  async uploadDocument(token: string, dto: PortalDocumentDto, file: UploadedResume | undefined) {
    return this.withOffer(token, async (o) => {
      await this.assertPrejoiningOpen(o);
      if (!file) throw AppError.validation([{ field: 'file', message: 'Attach the document' }]);
      if (file.size > RESUME_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The document must be 5 MB or smaller' }]);
      const type = detectDocumentType(file.buffer);
      if (!type) throw AppError.validation([{ field: 'file', message: 'Upload a PDF, PNG, JPG or WebP file' }]);
      if ((await OfferDocument.count({ where: { offerId: o.id } })) >= PREJOINING_MAX_DOCUMENTS) throw AppError.conflict(`Upload at most ${PREJOINING_MAX_DOCUMENTS} documents`);
      const key = `organizations/${o.organizationId}/prejoining/${o.id}/${randomUUID()}`;
      await this.storage.put(key, file.buffer, type);
      try {
        await this.db.transaction(async (transaction) => {
          const d = await OfferDocument.create(
            {
              organizationId: o.organizationId,
              offerId: o.id,
              category: dto.category,
              title: dto.title.trim(),
              fileName: safeFileName(file.originalname, dto.title, type),
              contentType: type,
              byteSize: file.size,
              checksum: createHash('sha256').update(file.buffer).digest('hex'),
              storageKey: key,
            },
            { transaction },
          );
          await this.audit.record(
            { action: 'offer.prejoining_document_uploaded', entityType: 'OfferDocument', entityId: d.id, actorUserId: null, summary: `Pre-joining document "${d.title}" uploaded by the candidate` },
            transaction,
          );
        });
      } catch (e) {
        await this.storage.deleteQuietly([key]);
        throw e;
      }
      return this.view(token);
    });
  }

  async removeDocument(token: string, documentId: string) {
    return this.withOffer(token, async (o) => {
      await this.assertPrejoiningOpen(o);
      const d = await OfferDocument.findOne({ where: { id: documentId, offerId: o.id } });
      if (!d) throw AppError.notFound('Document');
      await this.db.transaction(async (transaction) => {
        await d.destroy({ transaction });
        await this.audit.record(
          { action: 'offer.prejoining_document_removed', entityType: 'OfferDocument', entityId: d.id, actorUserId: null, summary: `Pre-joining document "${d.title}" removed by the candidate` },
          transaction,
        );
      });
      await this.storage.deleteQuietly([d.storageKey]);
      return this.view(token);
    });
  }

  private async assertPrejoiningOpen(o: Offer) {
    if (o.status !== 'ACCEPTED') throw AppError.conflict('Accept the offer first');
    const app = await JobApplication.findByPk(o.applicationId, { attributes: ['stage'] });
    if (app?.stage === 'HIRED') throw AppError.conflict("You've joined: update your details in the HR app instead");
  }

  /** Finds the offer by its link (only the token's hash is stored) and runs in its organization. */
  private async withOffer<T>(token: string, fn: (o: Offer, org: Organization) => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw AppError.notFound('Offer');
    const o = await Offer.findOne({ where: { portalTokenHash: sha256(token) }, skipTenantScope: true });
    if (!o || !o.portalExpiresAt || o.portalExpiresAt < new Date() || o.status === 'WITHDRAWN' || o.status === 'DRAFT') throw AppError.notFound('Offer');
    const org = await Organization.findByPk(o.organizationId, { attributes: ['id', 'name', 'logoUrl', 'brandColor', 'timezone', 'status'] });
    if (!org || org.status !== 'ACTIVE') throw AppError.notFound('Offer');
    const store = RequestContext.get();
    return RequestContext.runForTenant(org.id, () => fn(o, org), { requestId: store?.requestId, ipAddress: store?.ipAddress, userAgent: store?.userAgent });
  }
}
