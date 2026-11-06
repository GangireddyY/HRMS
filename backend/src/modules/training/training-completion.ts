import { randomBytes } from 'node:crypto';
import type { Transaction } from 'sequelize';
import type { TrainingCourse, TrainingEnrollment } from '../../database/models';
import { certificateExpiry, missingRequirements } from './training-rules';

export const isSessionBased = (c: Pick<TrainingCourse, 'delivery'>) => c.delivery !== 'SELF_PACED';

export function requirementsLeft(e: TrainingEnrollment, c: TrainingCourse): string[] {
  return missingRequirements({ sessionBased: isSessionBased(c), attended: e.attended, hasAssessment: c.hasAssessment, passed: e.passed, markedDone: e.markedDone });
}

/**
 * Completes an open enrolment once every requirement is met: completion date, certificate number (40 random bits,
 * unique index) and expiry. Returns true when it was completed by this call.
 */
export async function completeIfDone(e: TrainingEnrollment, c: TrainingCourse, today: string, transaction: Transaction): Promise<boolean> {
  if (e.status !== 'ENROLLED' && e.status !== 'IN_PROGRESS') return false;
  if (requirementsLeft(e, c).length) return false;
  await e.update(
    {
      status: 'COMPLETED',
      completedAt: new Date(),
      completedOn: today,
      certificateNumber: `TRN-${randomBytes(5).toString('hex').toUpperCase()}`,
      expiresOn: certificateExpiry(today, c.validityMonths),
    },
    { transaction },
  );
  return true;
}
