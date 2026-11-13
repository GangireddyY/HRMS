import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import type { EmploymentType } from '../../contracts';
import { RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import { Candidate, Department, JobApplication, JobOpening, JobRequisition, Location, Organization } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessService } from '../rbac/access.service';
import { CandidatesService, type UploadedResume } from './candidates.service';
import type { PublicApplicationDto } from './dto/recruitment.dto';

const ref = (r: { id: string; name: string } | null | undefined) => (r ? { id: r.id, name: r.name } : null);
const JOB_TYPE: Record<EmploymentType, string> = { FULL_TIME: 'fulltime', PART_TIME: 'parttime', CONTRACT: 'contract', INTERN: 'internship' };
/** A CDATA section (a literal "]]>" is split across two sections); control characters XML forbids are dropped. */
const cdata = (s: string) => `<![CDATA[${s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
/** Shown for every accepted submission, whether or not the person was already on file (no account enumeration). */
const RECEIVED = { received: true, message: 'Thank you! Your application has been received. The hiring team will be in touch if your profile is a match.' };

/**
 * The public careers page of an organization: open jobs marked public, and applications with a resume.
 * Only active organizations entitled to recruitment are served; everything runs bound to that tenant.
 */
@Injectable()
export class CareersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly candidates: CandidatesService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async page(slug: string) {
    return this.forOrganization(slug, async (org) => {
      const jobs = await JobOpening.findAll({
        where: { status: 'OPEN', isPublic: true, [Op.or]: [{ closesOn: null }, { closesOn: { [Op.gte]: new Date().toISOString().slice(0, 10) } }] },
        include: [
          {
            model: JobRequisition,
            attributes: ['id', 'employmentType', 'departmentId', 'locationId'],
            include: [
              { model: Department, attributes: ['id', 'name'] },
              { model: Location, attributes: ['id', 'name'] },
            ],
          },
        ],
        order: [['openedAt', 'DESC']],
        limit: 200,
      });
      return { organization: this.profile(org), jobs: jobs.map((j) => this.summary(j)) };
    });
  }

  async job(slug: string, jobId: string) {
    return this.forOrganization(slug, async (org) => {
      const j = await this.publicJob(jobId);
      return { organization: this.profile(org), job: { ...this.summary(j), description: j.description, requirements: j.requirements, address: this.address(j) } };
    });
  }

  /**
   * The open public jobs as an XML job feed (the Indeed format, also read by Jooble, Adzuna, Careerjet and most
   * aggregators). Each job links to its page on the careers site, where people apply.
   */
  async feed(slug: string): Promise<string> {
    return this.forOrganization(slug, async (org) => {
      const jobs = await JobOpening.findAll({
        where: { status: 'OPEN', isPublic: true, [Op.or]: [{ closesOn: null }, { closesOn: { [Op.gte]: new Date().toISOString().slice(0, 10) } }] },
        include: [
          {
            model: JobRequisition,
            attributes: ['id', 'employmentType', 'departmentId', 'locationId'],
            include: [
              { model: Department, attributes: ['id', 'name'] },
              { model: Location, attributes: ['id', 'name', 'city', 'state', 'country'] },
            ],
          },
        ],
        order: [['openedAt', 'DESC']],
        limit: 500,
      });
      const site = `${this.config.get('APP_URL').replace(/\/+$/, '')}/careers/${org.slug}`;
      const items = jobs.map((j) => {
        const a = this.address(j);
        const text = [j.description, j.requirements ? `Requirements:\n${j.requirements}` : null].filter(Boolean).join('\n\n');
        const experience = j.experienceMin != null ? `${j.experienceMin}${j.experienceMax != null ? `-${j.experienceMax}` : '+'} years` : null;
        return [
          '  <job>',
          `    <title>${cdata(j.title)}</title>`,
          `    <date>${cdata((j.openedAt ?? j.createdAt).toUTCString())}</date>`,
          `    <referencenumber>${cdata(j.id)}</referencenumber>`,
          `    <url>${cdata(`${site}/jobs/${j.id}`)}</url>`,
          `    <company>${cdata(org.name)}</company>`,
          `    <city>${cdata(a.city ?? '')}</city>`,
          `    <state>${cdata(a.state ?? '')}</state>`,
          `    <country>${cdata(a.country ?? '')}</country>`,
          `    <description>${cdata(text)}</description>`,
          `    <jobtype>${cdata(JOB_TYPE[(j.requisition?.employmentType ?? 'FULL_TIME') as EmploymentType])}</jobtype>`,
          j.requisition?.department ? `    <category>${cdata(j.requisition.department.name)}</category>` : null,
          experience ? `    <experience>${cdata(experience)}</experience>` : null,
          j.closesOn ? `    <expirationdate>${cdata(j.closesOn)}</expirationdate>` : null,
          '  </job>',
        ]
          .filter(Boolean)
          .join('\n');
      });
      return ['<?xml version="1.0" encoding="utf-8"?>', '<source>', `  <publisher>${cdata(org.name)}</publisher>`, `  <publisherurl>${cdata(site)}</publisherurl>`, `  <lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>`, ...items, '</source>', ''].join('\n');
    });
  }

  async apply(slug: string, jobId: string, dto: PublicApplicationDto, file: UploadedResume | undefined) {
    if (!dto.consent) throw AppError.validation([{ field: 'consent', message: 'Please agree to the processing of your data to apply' }]);
    return this.forOrganization(slug, async (org) => {
      const job = await this.publicJob(jobId);
      const existing = await Candidate.findOne({ where: { email: dto.email } });
      const created = await this.db.transaction(async (transaction) => {
        let candidate = existing;
        if (!candidate) {
          candidate = await Candidate.create(
            {
              organizationId: org.id,
              firstName: dto.firstName,
              lastName: dto.lastName,
              email: dto.email,
              phone: dto.phone ?? null,
              linkedinUrl: dto.linkedinUrl ?? null,
              notes: dto.coverNote ? `Cover note: ${dto.coverNote}` : null,
              source: 'CAREERS',
              consentAt: new Date(),
            },
            { transaction },
          );
          await this.candidates.uploadResume(null, org.id, candidate, file, transaction);
        } else if (!candidate.resumeKey && file?.buffer?.length) {
          // Existing records are never overwritten from the public form; a missing resume is the only thing added.
          await this.candidates.uploadResume(null, org.id, candidate, file, transaction);
        }
        if (await JobApplication.count({ where: { jobId: job.id, candidateId: candidate.id }, transaction })) return null;
        const app = await this.candidates.addApplication(org.id, job.id, candidate.id, 'CAREERS', null, transaction);
        await this.audit.record(
          { organizationId: org.id, action: 'application.received', entityType: 'JobApplication', entityId: app.id, summary: `Careers application for "${job.title}"` },
          transaction,
        );
        return app;
      });
      if (created && job.createdById) {
        await this.notifications.notify(job.createdById, {
          organizationId: org.id,
          type: 'recruitment.application',
          title: `New application for ${job.title}`,
          body: `${dto.firstName} ${dto.lastName}`,
          link: `/hr/recruitment/jobs/${job.id}`,
        });
      }
      return RECEIVED;
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async forOrganization<T>(slug: string, fn: (org: Organization) => Promise<T>): Promise<T> {
    const org = await Organization.findOne({
      where: { slug: slug.toLowerCase(), status: 'ACTIVE' },
      attributes: ['id', 'name', 'slug', 'logoUrl', 'website', 'brandColor', 'industry', 'companySize', 'city', 'country', 'status'],
    });
    if (!org || !(await this.access.entitlements(org.id)).has('recruitment')) throw AppError.notFound('Careers page');
    const store = RequestContext.get();
    return RequestContext.runForTenant(org.id, () => fn(org), { requestId: store?.requestId, ipAddress: store?.ipAddress, userAgent: store?.userAgent });
  }

  private async publicJob(jobId: string): Promise<JobOpening> {
    const j = await JobOpening.findOne({
      where: { id: jobId, status: 'OPEN', isPublic: true, [Op.or]: [{ closesOn: null }, { closesOn: { [Op.gte]: new Date().toISOString().slice(0, 10) } }] },
      include: [
        {
          model: JobRequisition,
          attributes: ['id', 'employmentType', 'departmentId', 'locationId'],
          include: [
            { model: Department, attributes: ['id', 'name'] },
            { model: Location, attributes: ['id', 'name', 'city', 'state', 'country'] },
          ],
        },
      ],
    });
    if (!j) throw AppError.notFound('Job');
    return j;
  }

  /** What a job seeker may see about the employer: only details an organization already shows publicly. */
  private profile(org: Organization) {
    return { name: org.name, logoUrl: org.logoUrl, website: org.website, brandColor: org.brandColor, industry: org.industry, companySize: org.companySize, city: org.city, country: org.country };
  }

  private address(j: JobOpening) {
    const l = j.requisition?.location;
    return { city: l?.city ?? null, state: l?.state ?? null, country: l?.country ?? null };
  }

  private summary(j: JobOpening) {
    return {
      id: j.id,
      title: j.title,
      department: ref(j.requisition?.department),
      location: ref(j.requisition?.location),
      employmentType: j.requisition?.employmentType ?? 'FULL_TIME',
      experienceMin: j.experienceMin,
      experienceMax: j.experienceMax,
      closesOn: j.closesOn,
      postedAt: j.openedAt,
    };
  }
}
