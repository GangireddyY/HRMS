import type { EmployeeStatus, EmploymentType, Gender, LifecycleAction, LifecycleEventType } from '@contracts';

export interface Department {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  parentName: string | null;
  description: string | null;
  isActive: boolean;
  employeeCount: number;
}

export interface Designation {
  id: string;
  name: string;
  level: number | null;
  description: string | null;
  isActive: boolean;
  employeeCount: number;
}

export interface Location {
  id: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone: string | null;
  isActive: boolean;
  employeeCount: number;
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  dateOfJoining: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  probationEndDate: string | null;
  exitDate: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  department: NamedRef | null;
  designation: NamedRef | null;
  location: NamedRef | null;
  shift: NamedRef | null;
  manager: { id: string; name: string; employeeCode: string } | null;
  account: { membershipId: string; email: string | null; status: string } | null;
  hasBankAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDetail extends Employee {
  directReports: { id: string; name: string; employeeCode: string; status: EmployeeStatus; designation: NamedRef | null }[];
}

export interface LifecycleEvent {
  id: string;
  type: LifecycleEventType;
  effectiveDate: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface SensitiveDetails {
  pan: string | null;
  uan: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
}

export interface LinkableMember {
  membershipId: string;
  status: string;
  email: string;
  firstName: string;
  lastName: string;
  joinedAt: string | null;
  roles: string[];
}

export interface EmployeeInput {
  employeeCode?: string | null;
  firstName: string;
  lastName: string;
  workEmail?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: Gender | null;
  dateOfJoining: string;
  employmentType?: EmploymentType;
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  shiftId?: string | null;
  membershipId?: string | null;
  probationEndDate?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

export interface LifecycleInput {
  type: LifecycleAction;
  effectiveDate: string;
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  status?: EmployeeStatus;
  note?: string | null;
}
