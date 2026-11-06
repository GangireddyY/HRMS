import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, GENDERS, type EmployeeStatus, type EmploymentType, type Gender, type LifecycleEventType } from '@contracts';
import type { SelectOption } from '@/shared/components';

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = { ACTIVE: 'Active', ON_NOTICE: 'On notice', EXITED: 'Exited' };
export const employeeStatusTone: Record<EmployeeStatus, 'success' | 'warning' | 'neutral'> = { ACTIVE: 'success', ON_NOTICE: 'warning', EXITED: 'neutral' };
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACT: 'Contract', INTERN: 'Intern' };
export const GENDER_LABELS: Record<Gender, string> = { MALE: 'Male', FEMALE: 'Female', NON_BINARY: 'Non-binary', UNDISCLOSED: 'Prefer not to say' };
export const LIFECYCLE_LABELS: Record<LifecycleEventType, string> = {
  JOINED: 'Joined',
  TRANSFER: 'Transfer',
  PROMOTION: 'Promotion',
  MANAGER_CHANGE: 'Manager change',
  STATUS_CHANGE: 'Status change',
  CONFIRMATION: 'Probation confirmed',
};
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  departmentId: 'Department',
  designationId: 'Designation',
  locationId: 'Location',
  managerId: 'Manager',
  status: 'Status',
  exitDate: 'Exit date',
  probationEndDate: 'Probation end',
};

export const employeeStatusOptions: SelectOption<EmployeeStatus>[] = EMPLOYEE_STATUSES.map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABELS[s] }));
export const employmentTypeOptions: SelectOption<EmploymentType>[] = EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }));
export const genderOptions: SelectOption<Gender>[] = GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }));
