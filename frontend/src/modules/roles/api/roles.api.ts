import { http } from '@/core/http/http-client';
import type { CatalogModule, Grant, RoleDetail, RoleSummary } from '../types';

export const rolesApi = {
  catalog: () => http.get<{ modules: CatalogModule[] }>('/permissions'),
  list: () => http.get<RoleSummary[]>('/roles'),
  get: (id: string) => http.get<RoleDetail>(`/roles/${id}`),
  create: (body: { name: string; description?: string; permissions: Grant[] }) => http.post<RoleDetail>('/roles', body),
  update: (id: string, body: { name?: string; description?: string }) => http.patch<RoleDetail>(`/roles/${id}`, body),
  setPermissions: (id: string, permissions: Grant[]) => http.put<RoleDetail>(`/roles/${id}/permissions`, { permissions }),
  remove: (id: string) => http.delete<{ deleted: boolean }>(`/roles/${id}`),
};
