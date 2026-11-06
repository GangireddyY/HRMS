import type { Component } from 'vue';
import {
  Bell,
  BookLock,
  DoorOpen,
  Fingerprint,
  Layers,
  Palette,
  Rocket,
  Scale,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from '@lucide/vue';
import { MODULES, type ModuleKey } from '@contracts';
import { MODULE_ICONS } from '@/shared/utils/module-icons';

export interface ShowcaseLeaf {
  key: string;
  label: string;
  description: string;
  icon: Component;
}

export interface ShowcaseBranch {
  key: string;
  label: string;
  icon: Component;
  /** Lifecycle stages hold HR modules; the last two branches hold platform capabilities. */
  kind: 'stage' | 'platform';
  leaves: ShowcaseLeaf[];
}

const moduleLeaves = (keys: ModuleKey[]): ShowcaseLeaf[] =>
  keys.map((key) => {
    const m = MODULES.find((x) => x.key === key)!;
    return { key, label: m.name, description: m.description, icon: MODULE_ICONS[key] };
  });

/** Everything the product covers, in reading order: the employee lifecycle, then the platform underneath. */
export const BRANCHES: ShowcaseBranch[] = [
  { key: 'hire', label: 'Hire', icon: UserPlus, kind: 'stage', leaves: moduleLeaves(['recruitment']) },
  { key: 'onboard', label: 'Onboard', icon: Rocket, kind: 'stage', leaves: moduleLeaves(['onboarding']) },
  { key: 'manage', label: 'Manage', icon: Users, kind: 'stage', leaves: moduleLeaves(['employee', 'attendance', 'leave']) },
  { key: 'pay', label: 'Pay', icon: Wallet, kind: 'stage', leaves: moduleLeaves(['payroll', 'benefits']) },
  { key: 'grow', label: 'Grow', icon: TrendingUp, kind: 'stage', leaves: moduleLeaves(['performance', 'training', 'engagement']) },
  { key: 'govern', label: 'Govern', icon: Scale, kind: 'stage', leaves: moduleLeaves(['grievance', 'compliance', 'reports']) },
  { key: 'exit', label: 'Exit', icon: DoorOpen, kind: 'stage', leaves: moduleLeaves(['exit']) },
  {
    key: 'security',
    label: 'Security',
    icon: ShieldCheck,
    kind: 'platform',
    leaves: [
      { key: 'rbac', label: 'Role-based access', description: 'Roles and permissions decide what each person can see and do.', icon: BookLock },
      { key: 'scopes', label: 'Record-level scopes', description: 'Grant access to own, team, department or organization records.', icon: Layers },
      { key: 'mfa', label: 'Two-factor authentication', description: 'Authenticator-app codes with one-time recovery codes.', icon: Fingerprint },
      { key: 'audit', label: 'Audit trail', description: 'Sensitive changes are recorded with who, what and when; secrets are redacted.', icon: ScrollText },
      { key: 'sessions', label: 'Session & device control', description: 'See where you are signed in and sign out other devices.', icon: Smartphone },
    ],
  },
  {
    key: 'platform',
    label: 'Platform',
    icon: ServerCog,
    kind: 'platform',
    leaves: [
      { key: 'tenancy', label: 'Multi-tenant by design', description: "Each organization's data is isolated from every other organization.", icon: Layers },
      { key: 'email', label: 'Email notifications', description: 'Invitations, password resets and account alerts by email.', icon: Bell },
      { key: 'themes', label: 'Themes & dark mode', description: 'Light and dark modes with several colour themes and sidebar styles.', icon: Palette },
    ],
  },
];
