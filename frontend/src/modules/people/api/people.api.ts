import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type {
  Department,
  Designation,
  Employee,
  EmployeeDetail,
  EmployeeInput,
  LifecycleEvent,
  LifecycleInput,
  LinkableMember,
  Location,
  SensitiveDetails,
} from '../types';

export type StructureKind = 'departments' | 'designations' | 'locations';

export const structureApi = {
  departments: () => http.get<Department[]>('/departments'),
  designations: () => http.get<Designation[]>('/designations'),
  locations: () => http.get<Location[]>('/locations'),
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
  employmentType?: string;
}

export const employeesApi = {
  list: (q: EmployeeListQuery) => http.page<Employee>('/employees', q),
  get: (id: string) => http.get<EmployeeDetail>(`/employees/${id}`),
  me: () => http.get<Employee | null>('/employees/me'),
  updateMe: (body: Partial<Pick<EmployeeInput, 'personalEmail' | 'phone' | 'address' | 'emergencyContactName' | 'emergencyContactPhone'>>) => http.patch<Employee>('/employees/me', body),
  create: (body: EmployeeInput) => http.post<EmployeeDetail>('/employees', body),
  update: (id: string, body: Partial<EmployeeInput>) => http.patch<EmployeeDetail>(`/employees/${id}`, body),
  remove: (id: string) => http.delete<{ deleted: boolean }>(`/employees/${id}`),
  lifecycle: (id: string, body: LifecycleInput) => http.post<EmployeeDetail>(`/employees/${id}/lifecycle`, body),
  history: (id: string) => http.get<LifecycleEvent[]>(`/employees/${id}/history`),
  sensitive: (id: string) => http.get<SensitiveDetails>(`/employees/${id}/sensitive`),
  updateSensitive: (id: string, body: Partial<SensitiveDetails>) => http.put<SensitiveDetails>(`/employees/${id}/sensitive`, body),
  linkableMembers: () => http.get<LinkableMember[]>('/employees/linkable-members'),
  createFromMembers: (membershipIds: string[]) =>
    http.post<{ created: number; employees: { id: string; employeeCode: string; fullName: string; membershipId: string }[] }>('/employees/from-members', { membershipIds }),
  exportCsv: (q: EmployeeListQuery) => downloadFile('/employees/export', q, 'employees.csv'),
};
