import type { MembershipStatus } from '@contracts';
import type { RoleRef } from '@/modules/roles/types';

export interface Member {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  status: MembershipStatus;
  accountStatus: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
  roles: RoleRef[];
  /** Linked employee record (only returned by the user detail endpoint). */
  employee?: { id: string; employeeCode: string } | null;
}
