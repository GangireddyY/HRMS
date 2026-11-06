import type { DocumentCategory } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type {
  CostCenter,
  Department,
  Designation,
  Employee,
  EmployeeDetail,
  EmployeeDocument,
  EmployeeInput,
  ExpiringDocument,
  Grade,
  ImportResult,
  LifecycleEvent,
  LifecycleInput,
  LinkableMember,
  Location,
  OrgChartNode,
  ProfileSection,
  ProfileSectionItem,
  SensitiveDetails,
} from '../types';

export type StructureKind = 'departments' | 'designations' | 'locations' | 'grades' | 'cost-centers';

export const structureApi = {
  departments: () => http.get<Department[]>('/departments'),
  designations: () => http.get<Designation[]>('/designations'),
  locations: () => http.get<Location[]>('/locations'),
  grades: () => http.get<Grade[]>('/grades'),
  costCenters: () => http.get<CostCenter[]>('/cost-centers'),
  create: (kind: StructureKind, body: Record<string, unknown>) => http.post<unknown>(`/${kind}`, body),
  update: (kind: StructureKind, id: string, body: Record<string, unknown>) => http.patch<unknown>(`/${kind}/${id}`, body),
  remove: (kind: StructureKind, id: string) => http.delete<{ deleted: boolean }>(`/${kind}/${id}`),
};

export interface EmployeeListQuery extends ListQuery {
  status?: string;
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  managerId?: string;
  gradeId?: string;
  costCenterId?: string;
  employmentType?: string;
}

export type SelfProfileInput = Partial<
  Pick<EmployeeInput, 'personalEmail' | 'phone' | 'address' | 'permanentAddress' | 'emergencyContactName' | 'emergencyContactPhone' | 'maritalStatus' | 'bloodGroup'>
>;

export interface DocumentInput {
  category: DocumentCategory;
  title: string;
  expiryDate?: string | null;
}

export const employeesApi = {
  list: (q: EmployeeListQuery) => http.page<Employee>('/employees', q),
  get: (id: string) => http.get<EmployeeDetail>(`/employees/${id}`),
  me: () => http.get<Employee | null>('/employees/me'),
  updateMe: (body: SelfProfileInput) => http.patch<Employee>('/employees/me', body),
  create: (body: EmployeeInput) => http.post<EmployeeDetail>('/employees', body),
  update: (id: string, body: Partial<EmployeeInput>) => http.patch<EmployeeDetail>(`/employees/${id}`, body),
  remove: (id: string) => http.delete<{ deleted: boolean }>(`/employees/${id}`),
  lifecycle: (id: string, body: LifecycleInput) => http.post<EmployeeDetail>(`/employees/${id}/lifecycle`, body),
  history: (id: string) => http.get<LifecycleEvent[]>(`/employees/${id}/history`),
  reportingChain: (id: string) => http.get<{ id: string; name: string; employeeCode: string; designation: { id: string; name: string } | null }[]>(`/employees/${id}/reporting-chain`),
  orgChart: (managerId?: string) => http.get<OrgChartNode[]>('/employees/org-chart', { managerId }),
  sensitive: (id: string) => http.get<SensitiveDetails>(`/employees/${id}/sensitive`),
  updateSensitive: (id: string, body: Partial<SensitiveDetails>) => http.put<SensitiveDetails>(`/employees/${id}/sensitive`, body),
  linkableMembers: () => http.get<LinkableMember[]>('/employees/linkable-members'),
  createFromMembers: (membershipIds: string[]) =>
    http.post<{ created: number; employees: { id: string; employeeCode: string; fullName: string; membershipId: string }[] }>('/employees/from-members', { membershipIds }),
  exportCsv: (q: EmployeeListQuery) => downloadFile('/employees/export', q, 'employees.csv'),
  importTemplate: () => downloadFile('/employees/import/template', undefined, 'employee-import-template.csv'),
  importCsv: (file: File, dryRun: boolean) => http.upload<ImportResult>('/employees/import', file, { query: { dryRun } }),
};

/** Family, education and previous-employment entries of one employee. */
export const profileApi = {
  list: <S extends ProfileSection>(employeeId: string, section: S) => http.get<ProfileSectionItem[S][]>(`/employees/${employeeId}/${section}`),
  create: <S extends ProfileSection>(employeeId: string, section: S, body: Record<string, unknown>) => http.post<ProfileSectionItem[S]>(`/employees/${employeeId}/${section}`, body),
  update: <S extends ProfileSection>(employeeId: string, section: S, id: string, body: Record<string, unknown>) =>
    http.patch<ProfileSectionItem[S]>(`/employees/${employeeId}/${section}/${id}`, body),
  remove: (employeeId: string, section: ProfileSection, id: string) => http.delete<{ deleted: boolean }>(`/employees/${employeeId}/${section}/${id}`),
};

export const documentsApi = {
  list: (employeeId: string) => http.get<EmployeeDocument[]>(`/employees/${employeeId}/documents`),
  upload: (employeeId: string, file: File, body: DocumentInput) =>
    http.upload<EmployeeDocument>(`/employees/${employeeId}/documents`, file, { fileName: file.name, fields: { category: body.category, title: body.title, expiryDate: body.expiryDate } }),
  update: (employeeId: string, id: string, body: Partial<DocumentInput>) => http.patch<EmployeeDocument>(`/employees/${employeeId}/documents/${id}`, body),
  review: (employeeId: string, id: string, status: 'VERIFIED' | 'REJECTED', note?: string | null) =>
    http.post<EmployeeDocument>(`/employees/${employeeId}/documents/${id}/review`, { status, note }),
  /** The file as a Blob (for previews); use `download` to save it. */
  blob: (employeeId: string, id: string) => http.download(`/employees/${employeeId}/documents/${id}/file`),
  download: (employeeId: string, doc: Pick<EmployeeDocument, 'id' | 'fileName'>) => downloadFile(`/employees/${employeeId}/documents/${doc.id}/file`, undefined, doc.fileName),
  remove: (employeeId: string, id: string) => http.delete<{ deleted: boolean }>(`/employees/${employeeId}/documents/${id}`),
  expiring: (days = 30) => http.get<ExpiringDocument[]>('/employees/documents/expiring', { days }),
};
