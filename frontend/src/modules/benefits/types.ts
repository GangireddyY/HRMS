import type { BenefitEnrollmentReason, BenefitEnrollmentStatus, BenefitPlanStatus, BenefitType, DependentRelation, EmploymentType, FamilyRelationship, LifeEvent } from '@contracts';

export interface PlanOption {
  id: string;
  name: string;
  coverageAmount: number | null;
  employeeMonthly: number;
  employerMonthly: number;
  allowedRelations: DependentRelation[];
  maxDependents: number;
  isDefault: boolean;
}

export interface PlanStats {
  enrolled: number;
  pending: number;
  waived: number;
  employeeMonthly: number;
  employerMonthly: number;
}

export interface Plan {
  id: string;
  name: string;
  type: BenefitType;
  provider: string | null;
  policyNumber: string | null;
  description: string | null;
  status: BenefitPlanStatus;
  coverageStartsOn: string;
  coverageEndsOn: string;
  enrollmentOpensOn: string | null;
  enrollmentClosesOn: string | null;
  mandatory: boolean;
  requiresApproval: boolean;
  employmentTypes: EmploymentType[] | null;
  departmentIds: string[] | null;
  locationIds: string[] | null;
  gradeIds: string[] | null;
  waitingDays: number;
  maxChildAge: number | null;
  options: PlanOption[];
  updatedAt: string;
  /** Only for benefits.manage. */
  stats?: PlanStats;
}

export interface Enrollment {
  id: string;
  plan: { id: string; name?: string; type?: BenefitType; provider?: string | null };
  employee: { id: string; name: string; employeeCode: string; department: string | null } | null;
  status: BenefitEnrollmentStatus;
  reason: BenefitEnrollmentReason;
  lifeEvent: LifeEvent | null;
  lifeEventDate: string | null;
  note: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  option: { id: string; name: string | null } | null;
  coverageAmount: number | null;
  employeeMonthly: number;
  employerMonthly: number;
  dependents: { id: string; familyMemberId: string | null; name: string; relationship: DependentRelation; dateOfBirth: string | null }[];
  replacesId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface MyPlan extends Plan {
  ineligible: string | null;
  eligibleFrom: string;
  window: { kind: 'OPEN_ENROLLMENT' | 'NEW_JOINER'; closesOn: string } | null;
  current: Enrollment | null;
  pending: Enrollment | null;
  waived: boolean;
  canWaive: boolean;
}

export interface FamilyDependent {
  id: string;
  name: string;
  relationship: FamilyRelationship;
  dateOfBirth: string | null;
  isDependent: boolean;
  coverable: boolean;
}

export interface MyBenefits {
  plans: MyPlan[];
  dependents: FamilyDependent[];
  history: Enrollment[];
  monthlyContribution: number;
}

export interface PlanOptionInput {
  id?: string;
  name: string;
  coverageAmount: number | null;
  employeeMonthly: number;
  employerMonthly: number;
  allowedRelations: DependentRelation[];
  maxDependents: number;
  isDefault: boolean;
}

export interface PlanInput {
  name: string;
  type: BenefitType;
  provider: string | null;
  policyNumber: string | null;
  description: string | null;
  coverageStartsOn: string;
  coverageEndsOn: string;
  enrollmentOpensOn: string | null;
  enrollmentClosesOn: string | null;
  mandatory: boolean;
  requiresApproval: boolean;
  employmentTypes: EmploymentType[] | null;
  departmentIds: string[] | null;
  locationIds: string[] | null;
  gradeIds: string[] | null;
  waitingDays: number;
  maxChildAge: number | null;
  options: PlanOptionInput[];
}
