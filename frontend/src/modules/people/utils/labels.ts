import {
  BLOOD_GROUPS,
  DOCUMENT_CATEGORIES,
  EDUCATION_LEVELS,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  FAMILY_RELATIONSHIPS,
  GENDERS,
  MARITAL_STATUSES,
  type BloodGroup,
  type DocumentCategory,
  type DocumentStatus,
  type EducationLevel,
  type EmployeeStatus,
  type EmploymentType,
  type FamilyRelationship,
  type Gender,
  type LifecycleEventType,
  type MaritalStatus,
} from '@contracts';
import type { SelectOption } from '@/shared/components';

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = { ACTIVE: 'Active', ON_NOTICE: 'On notice', EXITED: 'Exited' };
export const employeeStatusTone: Record<EmployeeStatus, 'success' | 'warning' | 'neutral'> = { ACTIVE: 'success', ON_NOTICE: 'warning', EXITED: 'neutral' };
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACT: 'Contract', INTERN: 'Intern' };
export const GENDER_LABELS: Record<Gender, string> = { MALE: 'Male', FEMALE: 'Female', NON_BINARY: 'Non-binary', UNDISCLOSED: 'Prefer not to say' };
export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  SINGLE: 'Single',
  MARRIED: 'Married',
  DIVORCED: 'Divorced',
  WIDOWED: 'Widowed',
  SEPARATED: 'Separated',
  UNDISCLOSED: 'Prefer not to say',
};
export const RELATIONSHIP_LABELS: Record<FamilyRelationship, string> = { SPOUSE: 'Spouse', CHILD: 'Child', FATHER: 'Father', MOTHER: 'Mother', SIBLING: 'Sibling', OTHER: 'Other' };
export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  SECONDARY: 'Secondary (10th)',
  HIGHER_SECONDARY: 'Higher secondary (12th)',
  DIPLOMA: 'Diploma',
  BACHELORS: "Bachelor's degree",
  MASTERS: "Master's degree",
  DOCTORATE: 'Doctorate',
  CERTIFICATION: 'Certification',
  OTHER: 'Other',
};
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  IDENTITY: 'Identity proof',
  ADDRESS: 'Address proof',
  EDUCATION: 'Education certificate',
  EXPERIENCE: 'Experience / relieving letter',
  OFFER_LETTER: 'Offer letter',
  CONTRACT: 'Contract / agreement',
  CERTIFICATION: 'Professional certification',
  MEDICAL: 'Medical',
  OTHER: 'Other',
};
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = { PENDING: 'Awaiting verification', VERIFIED: 'Verified', REJECTED: 'Rejected' };
export const documentStatusTone: Record<DocumentStatus, 'warning' | 'success' | 'danger'> = { PENDING: 'warning', VERIFIED: 'success', REJECTED: 'danger' };

export const LIFECYCLE_LABELS: Record<LifecycleEventType, string> = {
  JOINED: 'Joined',
  TRANSFER: 'Transfer',
  PROMOTION: 'Promotion',
  MANAGER_CHANGE: 'Manager change',
  STATUS_CHANGE: 'Status change',
  CONFIRMATION: 'Probation confirmed',
  PROBATION_EXTENDED: 'Probation extended',
};
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  departmentId: 'Department',
  designationId: 'Designation',
  locationId: 'Location',
  gradeId: 'Grade',
  costCenterId: 'Cost center',
  managerId: 'Manager',
  status: 'Status',
  exitDate: 'Exit date',
  probationEndDate: 'Probation end',
};

export const employeeStatusOptions: SelectOption<EmployeeStatus>[] = EMPLOYEE_STATUSES.map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABELS[s] }));
export const employmentTypeOptions: SelectOption<EmploymentType>[] = EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }));
export const genderOptions: SelectOption<Gender>[] = GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }));
export const maritalStatusOptions: SelectOption<MaritalStatus>[] = MARITAL_STATUSES.map((s) => ({ value: s, label: MARITAL_STATUS_LABELS[s] }));
export const bloodGroupOptions: SelectOption<BloodGroup>[] = BLOOD_GROUPS.map((b) => ({ value: b, label: b }));
export const relationshipOptions: SelectOption<FamilyRelationship>[] = FAMILY_RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }));
export const educationLevelOptions: SelectOption<EducationLevel>[] = EDUCATION_LEVELS.map((l) => ({ value: l, label: EDUCATION_LEVEL_LABELS[l] }));
export const documentCategoryOptions: SelectOption<DocumentCategory>[] = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }));

/** "1.2 MB", "340 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
