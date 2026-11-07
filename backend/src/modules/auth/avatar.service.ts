import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { User, UserAvatar } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { detectImageType, type UploadedImage } from '../organizations/organization-logo.service';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** Hard cap while streaming; anything between this and AVATAR_MAX_BYTES gets a friendly message. */
export const AVATAR_UPLOAD_LIMIT_BYTES = 2 * AVATAR_MAX_BYTES;
/** Stored photos are square, this many pixels a side (crisp at 2× for the largest avatar). */
const AVATAR_EDGE = 256;
/** Matches the user_avatars byte_size check. */
const STORED_MAX_BYTES = 512 * 1024;
/** Characters of the checksum in the URL: without them the photo isn't served, so it can't be fetched by user id. */
const VERSION_LENGTH = 16;

/** API-relative, versioned URL; changes with the content so it can be cached forever. */
export const avatarPath = (userId: string, checksum: string) => `/users/${userId}/avatar?v=${checksum.slice(0, VERSION_LENGTH)}`;

/**
 * Applies camera rotation, crops to a square around the most interesting area (usually the face) and re-encodes as
 * WebP, which also strips metadata such as GPS position.
 */
export async function normalizeAvatar(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: AVATAR_EDGE, height: AVATAR_EDGE, fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 85, effort: 5 })
    .toBuffer();
}

/** Profile photos: everyone manages their own (an account-level photo, shown in every organization they belong to). */
@Injectable()
export class AvatarService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async upload(auth: AuthContext, file: UploadedImage | undefined): Promise<{ avatarUrl: string }> {
    if (!file?.buffer?.length) throw AppError.validation([{ field: 'file', message: 'Choose a photo to upload' }]);
    if (file.size > AVATAR_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The photo must be 5 MB or smaller' }]);
    const sourceType = detectImageType(file.buffer);
    if (!sourceType) throw AppError.validation([{ field: 'file', message: 'Upload a PNG, JPG or WebP image' }]);
    let data: Buffer;
    try {
      data = await normalizeAvatar(file.buffer);
    } catch {
      throw AppError.validation([{ field: 'file', message: 'This image could not be read. Try another photo.' }]);
    }
    if (data.length > STORED_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'This photo is too detailed. Try another one.' }]);

    const checksum = createHash('sha256').update(data).digest('hex');
    const avatarUrl = avatarPath(auth.userId, checksum);
    const values = { contentType: 'image/webp', data, byteSize: data.length, checksum };
    await this.db.transaction(async (transaction) => {
      const existing = await UserAvatar.findByPk(auth.userId, { transaction });
      if (existing) await existing.update(values, { transaction });
      else await UserAvatar.create({ userId: auth.userId, ...values }, { transaction });
      await User.update({ avatarUrl, updatedById: auth.userId }, { where: { id: auth.userId }, transaction });
      await this.audit.record(
        { action: 'user.avatar_updated', entityType: 'User', entityId: auth.userId, summary: 'Profile photo updated', metadata: { sourceType, sourceBytes: file.size, byteSize: data.length } },
        transaction,
      );
    });
    return { avatarUrl };
  }

  async remove(auth: AuthContext): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const removed = await UserAvatar.destroy({ where: { userId: auth.userId }, transaction });
      await User.update({ avatarUrl: null, updatedById: auth.userId }, { where: { id: auth.userId }, transaction });
      if (removed) await this.audit.record({ action: 'user.avatar_removed', entityType: 'User', entityId: auth.userId, summary: 'Profile photo removed' }, transaction);
    });
  }

  /** For <img> tags (which can't send the bearer token): served only with the current version from the API. */
  async find(userId: string, version: string | undefined): Promise<UserAvatar | null> {
    if (!version || version.length !== VERSION_LENGTH) return null;
    const avatar = await UserAvatar.findByPk(userId);
    return avatar && avatar.checksum.startsWith(version) ? avatar : null;
  }
}
