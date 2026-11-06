import type { Component } from 'vue';
import {
  Building2,
  CalendarDays,
  ChartColumn,
  Clock,
  DoorOpen,
  FileCheck2,
  GraduationCap,
  HeartHandshake,
  Megaphone,
  MessageSquareWarning,
  Rocket,
  TrendingUp,
  Users,
  UserSearch,
  Wallet,
} from '@lucide/vue';
import type { ModuleKey } from '@contracts';

/** Icon per product module (keys from the shared module catalog). */
export const MODULE_ICONS: Record<ModuleKey, Component> = {
  core: Building2,
  employee: Users,
  recruitment: UserSearch,
  onboarding: Rocket,
  attendance: Clock,
  leave: CalendarDays,
  payroll: Wallet,
  performance: TrendingUp,
  training: GraduationCap,
  engagement: Megaphone,
  grievance: MessageSquareWarning,
  benefits: HeartHandshake,
  compliance: FileCheck2,
  exit: DoorOpen,
  reports: ChartColumn,
};
