import type { ModuleKey, PermissionScope } from '@contracts';

export interface RoleRef {
  id: string;
  key: string;
  name: string;
}

export interface RoleSummary extends RoleRef {
  description: string | null;
  isSystem: boolean;
  isLocked: boolean;
  updatedAt: string;
  memberCount: number;
  permissionCount: number;
}

export interface Grant {
  key: string;
  scope: PermissionScope;
}

export interface RoleDetail extends RoleRef {
  description: string | null;
  isSystem: boolean;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  permissions: Grant[];
}

export interface CatalogPermission {
  key: string;
  page: string;
  description: string;
  scopable: boolean;
  restricted: boolean;
}

export interface CatalogModule {
  key: ModuleKey;
  name: string;
  description: string;
  entitled: boolean;
  permissions: CatalogPermission[];
}
