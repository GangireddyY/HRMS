import { randomBytes } from 'node:crypto';
import type { Transaction } from 'sequelize';
import { EmployeeSkill, TrainingCourseSkill, type TrainingCourse, type TrainingEnrollment } from '../../database/models';
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
  await awardCourseSkills(e, transaction);
  return true;
}

/** Completing a course verifies the skills it teaches at its level (never lowering a higher verified level). */
export async function awardCourseSkills(e: TrainingEnrollment, transaction: Transaction): Promise<void> {
  const taught = await TrainingCourseSkill.findAll({ where: { courseId: e.courseId }, transaction });
  for (const t of taught) {
    const existing = await EmployeeSkill.findOne({ where: { employeeId: e.employeeId, skillId: t.skillId }, transaction });
    const values = { verifiedLevel: t.level, verifiedSource: 'TRAINING' as const, verifiedAt: new Date(), verifiedById: null };
    if (!existing) await EmployeeSkill.create({ organizationId: e.organizationId, employeeId: e.employeeId, skillId: t.skillId, ...values }, { transaction });
    else if ((existing.verifiedLevel ?? 0) < t.level) await existing.update(values, { transaction });
  }
}
