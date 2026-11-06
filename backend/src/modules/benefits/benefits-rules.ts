import {
  LIFE_EVENT_WINDOW_DAYS,
  NEW_JOINER_WINDOW_DAYS,
  type DependentRelation,
  type EmployeeStatus,
  type EmploymentType,
  type BenefitEnrollmentReason,
  type BenefitEnrollmentStatus,
  type FamilyRelationship,
} from '../../contracts';
import { addDays } from '../../common/utils/zoned-time';

export interface EligibilityRules {
  employmentTypes: EmploymentType[] | null;
  departmentIds: string[] | null;
  locationIds: string[] | null;
  gradeIds: string[] | null;
  waitingDays: number;
  coverageStartsOn: string;
  coverageEndsOn: string;
  enrollmentOpensOn: string | null;
  enrollmentClosesOn: string | null;
}

export interface EligibilityPerson {
  status: EmployeeStatus;
  employmentType: EmploymentType;
  departmentId: string | null;
  locationId: string | null;
  gradeId: string | null;
  dateOfJoining: string;
}

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);
const listed = <T>(list: T[] | null, value: T | null) => !list?.length || (value !== null && list.includes(value));

/** Why the plan isn't offered to the employee, or null when it is. */
export function ineligibility(plan: EligibilityRules, e: EligibilityPerson): string | null {
  if (e.status === 'EXITED') return 'Not available after leaving the organization';
  if (!listed(plan.employmentTypes, e.employmentType)) return 'Not offered for this employment type';
  if (!listed(plan.departmentIds, e.departmentId)) return 'Not offered in this department';
  if (!listed(plan.locationIds, e.locationId)) return 'Not offered at this location';
  if (!listed(plan.gradeIds, e.gradeId)) return 'Not offered for this grade';
  return null;
}

/** The day the employee becomes eligible: joining date plus the waiting period. */
export const eligibleFrom = (plan: Pick<EligibilityRules, 'waitingDays'>, e: Pick<EligibilityPerson, 'dateOfJoining'>) => addDays(e.dateOfJoining, plan.waitingDays);

export interface EnrollmentWindow {
  kind: 'OPEN_ENROLLMENT' | 'NEW_JOINER';
  closesOn: string;
}

/**
 * When the employee may choose: during the plan's open enrolment window, or within 30 days of becoming eligible
 * (new joiners). Never before eligibility or after the policy period.
 */
export function enrollmentWindow(plan: EligibilityRules, e: EligibilityPerson, today: string): EnrollmentWindow | null {
  if (today > plan.coverageEndsOn) return null;
  const from = eligibleFrom(plan, e);
  if (today < from) return null;
  if (plan.enrollmentOpensOn && plan.enrollmentClosesOn && today >= plan.enrollmentOpensOn && today <= plan.enrollmentClosesOn) {
    return { kind: 'OPEN_ENROLLMENT', closesOn: plan.enrollmentClosesOn };
  }
  const joinerCloses = addDays(from, NEW_JOINER_WINDOW_DAYS);
  if (today <= joinerCloses) return { kind: 'NEW_JOINER', closesOn: earlier(joinerCloses, plan.coverageEndsOn) };
  return null;
}

/** A life event allows a change when it happened within the last 30 days (and within the policy period). */
export function lifeEventProblem(eventDate: string, today: string, plan: Pick<EligibilityRules, 'coverageStartsOn' | 'coverageEndsOn'>): string | null {
  if (eventDate > today) return "The event date can't be in the future";
  if (eventDate > plan.coverageEndsOn) return 'The event is after the end of the policy period';
  if (addDays(eventDate, LIFE_EVENT_WINDOW_DAYS) < today) return `Changes after a life event must be requested within ${LIFE_EVENT_WINDOW_DAYS} days of it`;
  return null;
}

/**
 * When coverage starts: never before the policy start or eligibility — from eligibility for new joiners and HR
 * enrolments, from the event for life events, and from today for changes made during the policy period.
 */
export function coverageStart(plan: EligibilityRules, e: EligibilityPerson, reason: BenefitEnrollmentReason, today: string, lifeEventDate?: string | null): string {
  const from = eligibleFrom(plan, e);
  const base = reason === 'LIFE_EVENT' ? lifeEventDate! : reason === 'OPEN_ENROLLMENT' ? today : from;
  return later(later(base, plan.coverageStartsOn), from);
}

/** Full years of age on a date. */
export function ageOn(dateOfBirth: string, on: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const isDependentRelation = (r: FamilyRelationship): r is DependentRelation => r === 'SPOUSE' || r === 'CHILD' || r === 'FATHER' || r === 'MOTHER';

export interface DependentCandidate {
  name: string;
  relationship: FamilyRelationship;
  dateOfBirth: string | null;
}

/** Problems with the dependants chosen for an option (relations covered, how many, one spouse / parent each, child age). */
export function dependentProblems(option: { allowedRelations: DependentRelation[]; maxDependents: number }, maxChildAge: number | null, deps: DependentCandidate[], on: string): string[] {
  const problems: string[] = [];
  if (deps.length > option.maxDependents) problems.push(option.maxDependents ? `This option covers up to ${option.maxDependents} dependant${option.maxDependents === 1 ? '' : 's'}` : 'This option covers only the employee');
  for (const d of deps) {
    if (!isDependentRelation(d.relationship) || !option.allowedRelations.includes(d.relationship)) {
      problems.push(`${d.name} (${d.relationship.toLowerCase()}) isn't covered by this option`);
      continue;
    }
    if (d.relationship === 'CHILD' && maxChildAge !== null) {
      if (!d.dateOfBirth) problems.push(`Add ${d.name}'s date of birth to cover them`);
      else if (ageOn(d.dateOfBirth, on) > maxChildAge) problems.push(`${d.name} is older than ${maxChildAge}, the age limit for children`);
    }
  }
  for (const single of ['SPOUSE', 'FATHER', 'MOTHER'] as const) {
    if (deps.filter((d) => d.relationship === single).length > 1) problems.push(`Only one ${single.toLowerCase()} can be covered`);
  }
  return problems;
}

/** Whether an enrolment's contribution is deducted in a payroll month: coverage on at least one day of it. */
export function chargedInMonth(e: { status: BenefitEnrollmentStatus; effectiveFrom: string | null; effectiveTo: string | null }, from: string, to: string): boolean {
  if ((e.status !== 'ACTIVE' && e.status !== 'ENDED') || !e.effectiveFrom) return false;
  return e.effectiveFrom <= to && (!e.effectiveTo || e.effectiveTo >= from);
}
