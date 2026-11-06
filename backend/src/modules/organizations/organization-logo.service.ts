import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Organization, OrganizationLogo } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';

/** Largest accepted upload; the stored logo is re-encoded and much smaller. */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
/** Hard upload cap enforced while streaming; anything between this and LOGO_MAX_BYTES gets a friendly message. */
export const LOGO_UPLOAD_LIMIT_BYTES = 2 * LOGO_MAX_BYTES;
/** Longest edge of the stored logo. */
const LOGO_MAX_EDGE = 1024;
/** Stored size limit (matches the organization_logos byte_size check). */
const STORED_MAX_BYTES = 1024 * 1024;

export interface NormalizedLogo {
  data: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
}

/**
 * Makes any accepted upload display well: applies camera rotation, trims empty borders (transparent or a
 * solid background colour), scales down to LOGO_MAX_EDGE and re-encodes as WebP with transparency.
 * Re-encoding also strips metadata and anything that is not pixel data.
 */
export async function normalizeLogo(input: Buffer): Promise<NormalizedLogo> {
  const base = () => sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
  let image = base();
  try {
    const trimmed = await base().trim({ threshold: 18 }).png().toBuffer();
    image = sharp(trimmed);
  } catch {
    // A single-colour image has nothing to trim; keep it as is.
  }
  const { data, info } = await image
    .resize({ width: LOGO_MAX_EDGE, height: LOGO_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, alphaQuality: 100, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  return { data, contentType: 'image/webp', width: info.width, height: info.height };
}

/** The subset of a Multer file this service needs. */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

type LogoContentType = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * The type is read from the file's own signature, never from the client-supplied MIME type or name.
 * SVG is deliberately not accepted: it can carry scripts.
 */
export function detectImageType(data: Buffer): LogoContentType | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** API-relative, versioned URL; the version changes with the content so it can be cached forever. */
export const logoPath = (organizationId: string, checksum: string) => `/organizations/${organizationId}/logo?v=${checksum.slice(0, 16)}`;

@Injectable()
export class OrganizationLogoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async upload(auth: AuthContext, file: UploadedImage | undefined): Promise<{ logoUrl: string }> {
    if (!file?.buffer?.length) throw AppError.validation([{ field: 'file', message: 'Choose an image to upload' }]);
    if (file.size > LOGO_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The logo must be 5 MB or smaller' }]);
    const sourceType = detectImageType(file.buffer);
    if (!sourceType) throw AppError.validation([{ field: 'file', message: 'Upload a PNG, JPG or WebP image' }]);

    let logo: NormalizedLogo;
    try {
      logo = await normalizeLogo(file.buffer);
    } catch {
      throw AppError.validation([{ field: 'file', message: 'This image could not be read. Try exporting it again as PNG.' }]);
    }
    if (logo.data.length > STORED_MAX_BYTES) {
      throw AppError.validation([{ field: 'file', message: 'This image is too detailed to use as a logo. Try a simpler PNG.' }]);
    }

    const organizationId = auth.organizationId!;
    const checksum = createHash('sha256').update(logo.data).digest('hex');
    const logoUrl = logoPath(organizationId, checksum);
    const contentType = logo.contentType;
    const values = { contentType, data: logo.data, byteSize: logo.data.length, checksum, updatedById: auth.userId };

    await this.db.transaction(async (transaction) => {
      const existing = await OrganizationLogo.findByPk(organizationId, { transaction });
      if (existing) await existing.update(values, { transaction });
      else await OrganizationLogo.create({ organizationId, ...values }, { transaction });
      await Organization.update({ logoUrl, updatedById: auth.userId }, { where: { id: organizationId }, transaction });
      await this.audit.record(
        {
          action: 'organization.logo_updated',
          entityType: 'Organization',
          entityId: organizationId,
          summary: 'Organization logo updated',
          metadata: { sourceType, sourceBytes: file.size, width: logo.width, height: logo.height, byteSize: logo.data.length },
        },
        transaction,
      );
    });
    return { logoUrl };
  }

  async remove(auth: AuthContext): Promise<void> {
    const organizationId = auth.organizationId!;
    await this.db.transaction(async (transaction) => {
      const removed = await OrganizationLogo.destroy({ where: { organizationId }, transaction });
      await Organization.update({ logoUrl: null, updatedById: auth.userId }, { where: { id: organizationId }, transaction });
      if (removed) {
        await this.audit.record({ action: 'organization.logo_removed', entityType: 'Organization', entityId: organizationId, summary: 'Organization logo removed' }, transaction);
      }
    });
  }

  /** Public read for <img> tags (which cannot send the bearer token); logos are brand assets, ids are unguessable. */
  find(organizationId: string): Promise<OrganizationLogo | null> {
    return OrganizationLogo.findByPk(organizationId, { skipTenantScope: true });
  }
}
