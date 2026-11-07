import type {
  BloodGroup,
  DocumentCategory,
  DocumentContentType,
  DocumentStatus,
  EducationLevel,
  EmployeeStatus,
  EmploymentType,
  FamilyRelationship,
  Gender,
  LifecycleAction,
  LifecycleEventType,
  MaritalStatus,
} from '@contracts';

export interface Grade {
  id: string;
  name: string;
  code: string | null;
  level: number | null;
  description: string | null;
  isActive: boolean;
  employeeCount: number;
}

export interface CostCenter {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  employeeCount: number;
}

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
  /** Decimal strings, e.g. "12.971600". */
  latitude: string | null;
  longitude: string | null;
  geofenceRadiusM: number | null;
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
  confirmedOn: string | null;
  exitDate: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  maritalStatus: MaritalStatus | null;
  bloodGroup: BloodGroup | null;
  nationality: string | null;
  permanentAddress: string | null;
  noticePeriodDays: number | null;
  department: NamedRef | null;
  designation: NamedRef | null;
  location: NamedRef | null;
  grade: NamedRef | null;
  costCenter: { id: string; name: string; code: string } | null;
  shift: NamedRef | null;
  manager: { id: string; name: string; employeeCode: string } | null;
  account: { membershipId: string; email: string | null; status: string } | null;
  /** Profile photo of the linked user account. */
  avatarUrl: string | null;
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
  aadhaar: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
}

export interface FamilyMember {
  id: string;
  name: string;
  relationship: FamilyRelationship;
  dateOfBirth: string | null;
  gender: Gender | null;
  phone: string | null;
  isDependent: boolean;
}

export interface Education {
  id: string;
  level: EducationLevel;
  qualification: string;
  specialization: string | null;
  institution: string;
  startYear: number | null;
  endYear: number | null;
  score: string | null;
}

export interface Experience {
  id: string;
  company: string;
  designation: string;
  startDate: string;
  endDate: string;
  location: string | null;
  description: string | null;
}

export type ProfileSection = 'family' | 'education' | 'experience';
export interface ProfileSectionItem {
  family: FamilyMember;
  education: Education;
  experience: Experience;
}

export interface EmployeeDocument {
  id: string;
  category: DocumentCategory;
  title: string;
  fileName: string;
  contentType: DocumentContentType;
  byteSize: number;
  expiryDate: string | null;
  status: DocumentStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  uploadedBy: string | null;
  uploadedById: string | null;
  createdAt: string;
}

export interface ExpiringDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  expiryDate: string;
  expired: boolean;
  employee: { id: string; name: string; employeeCode: string; department: string | null };
}

export interface OrgChartNode {
  id: string;
  name: string;
  employeeCode: string;
  status: EmployeeStatus;
  designation: NamedRef | null;
  department: NamedRef | null;
  reportCount: number;
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  valid: number;
  errorCount: number;
  errors: { row: number; column: string | null; message: string }[];
  ignoredColumns: string[];
  created: number;
}

export interface LinkableMember {
  membershipId: string;
  status: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
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
  gradeId?: string | null;
  costCenterId?: string | null;
  maritalStatus?: MaritalStatus | null;
  bloodGroup?: BloodGroup | null;
  nationality?: string | null;
  permanentAddress?: string | null;
  noticePeriodDays?: number | null;
}

export interface LifecycleInput {
  type: LifecycleAction;
  effectiveDate: string;
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  gradeId?: string | null;
  costCenterId?: string | null;
  status?: EmployeeStatus;
  note?: string | null;
}
