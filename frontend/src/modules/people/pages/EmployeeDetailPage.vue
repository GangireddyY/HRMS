<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft,
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  Cake,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Droplet,
  FileText,
  Flag,
  Globe,
  Hash,
  HeartPulse,
  History,
  Hourglass,
  IdCard,
  KeyRound,
  Layers,
  LogOut,
  Mail,
  MapPin,
  MapPinHouse,
  Network,
  PartyPopper,
  Pencil,
  Phone,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserCog,
  UserRound,
  UsersRound,
  Workflow,
} from '@lucide/vue';
import type { LifecycleAction } from '@contracts';
import { documentsApi, employeesApi, profileApi } from '@/modules/people/api/people.api';
import CustomFieldsCard from '@/modules/people/components/CustomFieldsCard.vue';
import DocumentsCard from '@/modules/people/components/DocumentsCard.vue';
import EmployeeFactGrid, { type EmployeeFact } from '@/modules/people/components/EmployeeFactGrid.vue';
import EmployeeHistoryTimeline from '@/modules/people/components/EmployeeHistoryTimeline.vue';
import LifecycleModal from '@/modules/people/components/LifecycleModal.vue';
import ProfileSectionCard from '@/modules/people/components/ProfileSectionCard.vue';
import SensitiveDetailsCard from '@/modules/people/components/SensitiveDetailsCard.vue';
import { daysUntil, relativeDays, tenure } from '@/modules/people/utils/dates';
import { employeeSignal } from '@/modules/people/utils/employee-signals';
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, GENDER_LABELS, LIFECYCLE_LABELS, MARITAL_STATUS_LABELS, employeeStatusTone } from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDropdown, AppEmptyState, AppErrorState, AppMenuItem, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';
import { COUNTRY_OPTIONS } from '@/shared/utils/options';
import { membershipTone, statusLabel } from '@/shared/utils/status';

import { profileCover } from '@/shared/utils/profile-cover';

/** HR's view of one employee: profile header with key facts and actions, tabbed record, and a side panel of people, dates and activity. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const employee = useAsync(() => employeesApi.get(id.value));
const history = useAsync(() => employeesApi.history(id.value));
const me = useAsync(() => employeesApi.me());

const isSelf = computed(() => !!me.data.value && me.data.value.id === id.value);
const canEditProfile = computed(() => auth.can('employee.update') || (isSelf.value && auth.can('self.profile.update')));
const showDocuments = computed(() => isSelf.value || auth.can('employee.document.manage'));

/** Entry counts for the tab badges and the record check; a section the viewer can't read just shows no count. */
const counts = useAsync(async () => {
  const empId = id.value;
  const safe = <T,>(p: Promise<T[]>) => p.then((r) => r.length).catch(() => null);
  const [family, education, experience, documents] = await Promise.all([
    safe(profileApi.list(empId, 'family')),
    safe(profileApi.list(empId, 'education')),
    safe(profileApi.list(empId, 'experience')),
    showDocuments.value ? safe(documentsApi.list(empId)) : Promise.resolve(null),
  ]);
  const background = family === null || education === null || experience === null ? null : family + education + experience;
  return { background, documents };
});
watch(id, () => {
  void employee.run();
  void history.run();
  void counts.run();
});
watch(showDocuments, () => void counts.run());

const tab = ref((route.query.tab as string) || 'overview');
const tabs = computed(() => [
  { key: 'overview', label: 'Overview', icon: IdCard },
  { key: 'profile', label: 'Family & background', icon: UsersRound, count: counts.data.value?.background ?? null },
  ...(showDocuments.value ? [{ key: 'documents', label: 'Documents', icon: FileText, count: counts.data.value?.documents ?? null }] : []),
  { key: 'history', label: 'History', icon: History, count: history.data.value?.length ?? null },
]);
watch(tab, (t, prev) => {
  void router.replace({ query: { ...route.query, tab: t === 'overview' ? undefined : t } });
  // Entries added on the background or documents tab update the counts once the user moves on.
  if (prev === 'profile' || prev === 'documents') void counts.run();
});

const lifecycleActions: { key: LifecycleAction; label: string; icon: typeof ArrowRightLeft }[] = [
  { key: 'TRANSFER', label: 'Transfer', icon: ArrowRightLeft },
  { key: 'PROMOTION', label: 'Promotion / grade change', icon: TrendingUp },
  { key: 'MANAGER_CHANGE', label: 'Change manager', icon: UserCog },
  { key: 'CONFIRMATION', label: 'Confirm probation', icon: BadgeCheck },
  { key: 'STATUS_CHANGE', label: 'Change status', icon: Workflow },
];
const action = ref<LifecycleAction | null>(null);
const availableActions = computed(() => (employee.data.value?.status === 'EXITED' ? lifecycleActions.filter((a) => a.key === 'STATUS_CHANGE') : lifecycleActions));

async function onLifecycleSaved(updated: typeof employee.data.value) {
  feedback.success(`${LIFECYCLE_LABELS[action.value!]} recorded`);
  action.value = null;
  employee.data.value = updated;
  await history.run();
}

async function remove() {
  const e = employee.data.value!;
  if (!(await feedback.confirm({ title: `Delete ${e.fullName}?`, message: 'Use this only for records created by mistake. To record someone leaving, change their status to Exited instead.', confirmLabel: 'Delete employee', danger: true, requireText: e.employeeCode }))) return;
  try {
    await employeesApi.remove(e.id);
    feedback.success('Employee deleted');
    await router.replace('/hr/employees');
  } catch (err) {
    feedback.error('Could not delete employee', err);
  }
}

const dash = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v);
const country = (code: string | null) => (code ? (COUNTRY_OPTIONS.find((c) => c.value === code)?.label ?? code) : '—');
const age = (dob: string) => {
  const [y, m, d] = dob.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
};
/** The next yearly occurrence (birthday, work anniversary) of a date, as `YYYY-MM-DD`. */
function nextYearly(iso: string): string {
  const [, m, d] = iso.split('-');
  const year = new Date().getFullYear();
  const thisYear = `${year}-${m}-${d}`;
  return daysUntil(thisYear) >= 0 ? thisYear : `${year + 1}-${m}-${d}`;
}

// ---- Header facts and signals --------------------------------------------------------------------------------
const signal = computed(() => (employee.data.value ? employeeSignal(employee.data.value) : null));
const headerStats = computed<{ label: string; value: string; hint: string; icon: Component; tile: string; to?: string }[]>(() => {
  const e = employee.data.value!;
  const started = daysUntil(e.dateOfJoining) <= 0;
  const stats: { label: string; value: string; hint: string; icon: Component; tile: string; to?: string }[] = [
    { label: 'Tenure', value: started ? tenure(e.dateOfJoining) : 'Not started', hint: started ? `Since ${formatDate(e.dateOfJoining)}` : `Joins ${relativeDays(e.dateOfJoining)}`, icon: Clock, tile: 'bg-accent-soft text-accent-fg' },
    { label: 'Reports to', value: e.manager?.name ?? 'No manager', hint: e.manager?.employeeCode ?? 'Top of the reporting line', icon: UsersRound, tile: 'bg-info-soft text-info-fg', to: e.manager ? `/hr/employees/${e.manager.id}` : undefined },
    { label: 'Direct reports', value: String(e.directReports.length), hint: e.directReports.length ? `${e.directReports.filter((r) => r.status !== 'EXITED').length} current` : 'No team', icon: Network, tile: 'bg-special-soft text-special-fg' },
  ];
  if (e.status !== 'ACTIVE' && e.exitDate) stats.push({ label: e.status === 'EXITED' ? 'Exited' : 'Last working day', value: formatDate(e.exitDate), hint: relativeDays(e.exitDate), icon: LogOut, tile: 'bg-warning-soft text-warning-fg' });
  else if (e.confirmedOn) stats.push({ label: 'Probation', value: 'Confirmed', hint: formatDate(e.confirmedOn), icon: BadgeCheck, tile: 'bg-success-soft text-success-fg' });
  else if (e.probationEndDate)
    stats.push({ label: 'Probation', value: `Ends ${formatDate(e.probationEndDate)}`, hint: relativeDays(e.probationEndDate), icon: Hourglass, tile: daysUntil(e.probationEndDate) < 0 ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg' });
  else stats.push({ label: 'Notice period', value: e.noticePeriodDays === null ? 'Not set' : `${e.noticePeriodDays} days`, hint: EMPLOYMENT_TYPE_LABELS[e.employmentType], icon: Hourglass, tile: 'bg-surface-muted text-fg-muted' });
  return stats;
});

// ---- Overview facts ------------------------------------------------------------------------------------------
const employmentFacts = computed<EmployeeFact[]>(() => {
  const e = employee.data.value!;
  return [
    { label: 'Employee ID', value: e.employeeCode, icon: Hash, mono: true },
    { label: 'Designation', value: dash(e.designation?.name), icon: BadgeCheck },
    { label: 'Department', value: dash(e.department?.name), icon: Building2 },
    { label: 'Grade', value: dash(e.grade?.name), icon: Layers },
    { label: 'Location', value: dash(e.location?.name), icon: MapPin },
    { label: 'Employment type', value: EMPLOYMENT_TYPE_LABELS[e.employmentType], icon: UserRound },
    { label: 'Shift', value: e.shift?.name ?? 'Default shift', icon: Clock },
    { label: 'Cost center', value: e.costCenter ? `${e.costCenter.code} – ${e.costCenter.name}` : '—', icon: CircleDollarSign },
    { label: 'Date of joining', value: formatDate(e.dateOfJoining), icon: CalendarDays, hint: daysUntil(e.dateOfJoining) > 0 ? relativeDays(e.dateOfJoining) : undefined },
    {
      label: 'Probation',
      value: e.confirmedOn ? `Confirmed ${formatDate(e.confirmedOn)}` : e.probationEndDate ? `Ends ${formatDate(e.probationEndDate)}` : '—',
      hint: !e.confirmedOn && e.probationEndDate ? relativeDays(e.probationEndDate) : undefined,
      icon: Hourglass,
    },
    { label: 'Notice period', value: e.noticePeriodDays === null ? '—' : `${e.noticePeriodDays} days`, icon: Flag },
    ...(e.exitDate ? [{ label: 'Exit date', value: formatDate(e.exitDate), hint: relativeDays(e.exitDate), icon: LogOut }] : []),
  ];
});
const personalFacts = computed<EmployeeFact[]>(() => {
  const e = employee.data.value!;
  return [
    { label: 'Work email', value: dash(e.workEmail), icon: Mail },
    { label: 'Personal email', value: dash(e.personalEmail), icon: Mail },
    { label: 'Phone', value: dash(e.phone), icon: Phone },
    { label: 'Date of birth', value: e.dateOfBirth ? formatDate(e.dateOfBirth) : '—', hint: e.dateOfBirth ? `${age(e.dateOfBirth)} years old` : undefined, icon: Cake },
    { label: 'Gender', value: e.gender ? GENDER_LABELS[e.gender] : '—', icon: UserRound },
    { label: 'Marital status', value: e.maritalStatus ? MARITAL_STATUS_LABELS[e.maritalStatus] : '—', icon: HeartPulse },
    { label: 'Blood group', value: dash(e.bloodGroup), icon: Droplet },
    { label: 'Nationality', value: country(e.nationality), icon: Globe },
    { label: 'Emergency contact', value: dash(e.emergencyContactName), hint: e.emergencyContactPhone ?? undefined, icon: Phone },
    { label: 'Current address', value: dash(e.address), icon: MapPinHouse, wide: true },
    { label: 'Permanent address', value: e.permanentAddress ?? (e.address ? 'Same as current address' : '—'), icon: MapPinHouse, wide: true },
  ];
});

// ---- Side panel ----------------------------------------------------------------------------------------------
const keyDates = computed(() => {
  const e = employee.data.value!;
  const list: { key: string; label: string; date: string; sub: string; icon: Component; dot: string }[] = [];
  const joined = daysUntil(e.dateOfJoining);
  list.push({ key: 'joined', label: joined > 0 ? 'Joins' : 'Joined', date: e.dateOfJoining, sub: joined > 0 ? relativeDays(e.dateOfJoining) : `${tenure(e.dateOfJoining)} ago`, icon: CalendarCheck, dot: 'bg-brand-500' });
  if (e.confirmedOn) list.push({ key: 'probation', label: 'Probation confirmed', date: e.confirmedOn, sub: relativeDays(e.confirmedOn), icon: BadgeCheck, dot: 'bg-success' });
  else if (e.probationEndDate) {
    const over = daysUntil(e.probationEndDate) < 0;
    list.push({ key: 'probation', label: over ? 'Probation ended' : 'Probation ends', date: e.probationEndDate, sub: relativeDays(e.probationEndDate), icon: Hourglass, dot: over ? 'bg-danger' : 'bg-warning' });
  }
  if (e.status !== 'EXITED' && joined <= 0) {
    const next = nextYearly(e.dateOfJoining);
    const years = Number(next.slice(0, 4)) - Number(e.dateOfJoining.slice(0, 4));
    if (years > 0) list.push({ key: 'anniversary', label: `${years}-year work anniversary`, date: next, sub: relativeDays(next), icon: PartyPopper, dot: 'bg-special' });
  }
  if (e.dateOfBirth && e.status !== 'EXITED') {
    const next = nextYearly(e.dateOfBirth);
    list.push({ key: 'birthday', label: 'Birthday', date: next, sub: relativeDays(next), icon: Cake, dot: 'bg-caution' });
  }
  if (e.exitDate) list.push({ key: 'exit', label: e.status === 'EXITED' ? 'Exited' : 'Last working day', date: e.exitDate, sub: relativeDays(e.exitDate), icon: CalendarClock, dot: 'bg-danger' });
  return list;
});

const checklist = computed(() => {
  const e = employee.data.value!;
  return [
    { label: 'Department & designation', done: !!(e.department && e.designation) },
    { label: 'Work email', done: !!e.workEmail },
    { label: 'Phone number', done: !!e.phone },
    { label: 'Date of birth', done: !!e.dateOfBirth },
    { label: 'Current address', done: !!e.address },
    { label: 'Emergency contact', done: !!(e.emergencyContactName && e.emergencyContactPhone) },
    { label: 'Bank account', done: e.hasBankAccount },
    { label: 'Sign-in account linked', done: !!e.account },
    ...(counts.data.value?.documents !== null && counts.data.value?.documents !== undefined ? [{ label: 'Documents on file', done: counts.data.value.documents > 0 }] : []),
  ];
});
const completeness = computed(() => Math.round((checklist.value.filter((i) => i.done).length / checklist.value.length) * 100));
const missing = computed(() => checklist.value.filter((i) => !i.done));
const ringTone = computed(() => (completeness.value >= 80 ? 'text-success' : completeness.value >= 50 ? 'text-warning' : 'text-danger'));
const CIRCUMFERENCE = 2 * Math.PI * 18;
</script>

<template>
  <div>
    <AppSkeleton v-if="employee.loading.value && !employee.data.value" :lines="8" />
    <AppErrorState v-else-if="employee.error.value" :error="employee.error.value" title="Could not load employee" @retry="employee.run" />
    <template v-else-if="employee.data.value">
      <RouterLink
        to="/hr/employees"
        class="group mb-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-fg-muted transition hover:text-fg max-lg:in-[#main]:hidden"
      >
        <ArrowLeft :size="13" class="transition group-hover:-translate-x-0.5 rtl:rotate-180" aria-hidden="true" /> All employees
      </RouterLink>

      <!-- Profile header (no overflow clipping: the lifecycle menu opens below it). -->
      <section class="card mb-4">
        <div
          class="h-24 rounded-t-[inherit] border-b border-line/50"
          :class="employee.data.value.status === 'EXITED' && 'grayscale-[60%]'"
          :style="profileCover(employee.data.value.id)"
          aria-hidden="true"
        />
        <div class="flex flex-wrap items-end gap-x-5 gap-y-4 px-5 pb-5 max-sm:flex-col max-sm:items-start max-sm:gap-y-3">
          <div class="relative z-10 -mt-12 rounded-full bg-surface p-1 shadow-sm">
            <AppAvatar :name="employee.data.value.fullName" :src="employee.data.value.avatarUrl" size="2xl" />
          </div>
          <div class="min-w-0 flex-1 pt-3 max-sm:w-full max-sm:pt-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="truncate text-xl font-semibold tracking-tight text-fg lg:text-2xl">{{ employee.data.value.fullName }}</h1>
              <AppBadge :tone="employeeStatusTone[employee.data.value.status]" dot>{{ EMPLOYEE_STATUS_LABELS[employee.data.value.status] }}</AppBadge>
              <AppBadge v-if="employee.data.value.grade" tone="violet">{{ employee.data.value.grade.name }}</AppBadge>
              <AppBadge v-if="isSelf" tone="brand">You</AppBadge>
            </div>
            <p class="mt-0.5 text-sm text-fg-muted">
              {{ [employee.data.value.designation?.name, employee.data.value.department?.name].filter(Boolean).join(' · ') || EMPLOYMENT_TYPE_LABELS[employee.data.value.employmentType] }}
            </p>
            <ul class="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
              <li class="inline-flex items-center gap-1.5"><Hash :size="13" aria-hidden="true" /><span class="sr-only">Employee ID</span><span class="font-mono text-fg">{{ employee.data.value.employeeCode }}</span></li>
              <li v-if="employee.data.value.location" class="inline-flex items-center gap-1.5"><MapPin :size="13" aria-hidden="true" />{{ employee.data.value.location.name }}</li>
              <li v-if="employee.data.value.workEmail" class="inline-flex min-w-0 items-center gap-1.5">
                <Mail :size="13" aria-hidden="true" /><a :href="`mailto:${employee.data.value.workEmail}`" class="truncate hover:text-accent-fg hover:underline">{{ employee.data.value.workEmail }}</a>
              </li>
              <li v-if="employee.data.value.phone" class="inline-flex items-center gap-1.5">
                <Phone :size="13" aria-hidden="true" /><a :href="`tel:${employee.data.value.phone.replace(/\s/g, '')}`" class="hover:text-accent-fg hover:underline">{{ employee.data.value.phone }}</a>
              </li>
              <li class="inline-flex items-center gap-1.5"><UserRound :size="13" aria-hidden="true" />{{ EMPLOYMENT_TYPE_LABELS[employee.data.value.employmentType] }}</li>
            </ul>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <AppButton variant="ghost" :icon="Network" :to="{ path: '/hr/org-chart', query: { focus: employee.data.value.id } }">Org chart</AppButton>
            <AppButton v-if="auth.can('employee.update')" variant="secondary" :icon="Pencil" :to="`/hr/employees/${employee.data.value.id}/edit`">Edit</AppButton>
            <AppDropdown v-if="auth.can('employee.lifecycle.manage')" label="Lifecycle actions" width="w-64">
              <template #trigger="{ toggle }">
                <AppButton :icon-right="ChevronDown" @click="toggle">Lifecycle action</AppButton>
              </template>
              <template #default="{ close }">
                <AppMenuItem v-for="a in availableActions" :key="a.key" :icon="a.icon" @select="close(); action = a.key">{{ a.label }}</AppMenuItem>
              </template>
            </AppDropdown>
            <AppButton v-if="auth.can('employee.delete')" variant="ghost" :icon="Trash2" aria-label="Delete employee" title="Delete employee" @click="remove" />
          </div>
        </div>

        <div class="overflow-hidden rounded-b-[inherit]">
        <dl class="grid grid-cols-2 gap-px border-t border-line/70 bg-line/70 lg:grid-cols-4">
          <div v-for="s in headerStats" :key="s.label" class="flex min-w-0 items-center gap-3 bg-surface px-5 py-3.5 max-sm:px-3">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg max-sm:hidden', s.tile]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
            <div class="min-w-0">
              <dt class="text-xs text-fg-muted">{{ s.label }}</dt>
              <dd class="truncate text-sm font-semibold text-fg">
                <RouterLink v-if="s.to" :to="s.to" class="hover:text-accent-fg hover:underline">{{ s.value }}</RouterLink>
                <template v-else>{{ s.value }}</template>
              </dd>
              <dd class="truncate text-2xs text-fg-subtle">{{ s.hint }}</dd>
            </div>
          </div>
        </dl>

        <!-- What needs doing about this person, if anything. -->
        <div
          v-if="signal && (signal.kind === 'probation-overdue' || signal.kind === 'probation-due')"
          :class="['flex flex-wrap items-center gap-3 border-t border-line/70 px-5 py-3', signal.kind === 'probation-overdue' ? 'bg-danger-soft/50' : 'bg-warning-soft/50']"
        >
          <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white', signal.kind === 'probation-overdue' ? 'bg-danger' : 'bg-warning']" aria-hidden="true"><Hourglass :size="15" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-fg">{{ signal.label }}</p>
            <p class="text-xs text-fg-muted">Review their probation and record the outcome.</p>
          </div>
          <AppButton v-if="auth.can('employee.lifecycle.manage')" size="sm" :icon="BadgeCheck" @click="action = 'CONFIRMATION'">Confirm probation</AppButton>
        </div>
        <div v-else-if="employee.data.value.status === 'ON_NOTICE'" class="flex flex-wrap items-center gap-3 border-t border-line/70 bg-warning-soft/50 px-5 py-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning text-white" aria-hidden="true"><LogOut :size="15" /></span>
          <p class="min-w-0 flex-1 text-sm text-fg">
            <span class="font-medium">Serving notice.</span>
            <template v-if="employee.data.value.exitDate"> Last working day {{ formatDate(employee.data.value.exitDate) }} ({{ relativeDays(employee.data.value.exitDate) }}).</template>
          </p>
        </div>
        <div v-else-if="!employee.data.value.account && employee.data.value.status !== 'EXITED'" class="flex flex-wrap items-center gap-3 border-t border-line/70 bg-info-soft/40 px-5 py-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-info text-white" aria-hidden="true"><KeyRound :size="15" /></span>
          <p class="min-w-0 flex-1 text-sm text-fg">
            <span class="font-medium">No sign-in account linked.</span>
            <span class="text-fg-muted"> They can't sign in or use self-service until a user account is linked.</span>
          </p>
          <AppButton v-if="auth.can('employee.update')" size="sm" variant="secondary" :icon="KeyRound" :to="`/hr/employees/${employee.data.value.id}/edit`">Link account</AppButton>
        </div>
        </div>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <AppTabs v-model="tab" :tabs="tabs" class="min-w-0">
          <div v-if="tab === 'overview'" class="space-y-4">
            <AppCard title="Employment" :icon="BadgeCheck" description="Placement, terms and reporting. Changes are recorded as lifecycle actions.">
              <EmployeeFactGrid :items="employmentFacts" />
            </AppCard>
            <AppCard title="Personal & contact" :icon="UserRound" description="Visible to HR and the employee.">
              <EmployeeFactGrid :items="personalFacts" />
            </AppCard>
            <CustomFieldsCard :key="employee.data.value.id" :employee-id="employee.data.value.id" />
            <SensitiveDetailsCard
              v-if="auth.can('employee.sensitive.view')"
              :employee-id="employee.data.value.id"
              :has-bank-account="employee.data.value.hasBankAccount"
              :can-edit="auth.can('employee.update')"
            />
          </div>

          <div v-else-if="tab === 'profile'" class="grid items-start gap-4 2xl:grid-cols-2">
            <ProfileSectionCard :employee-id="employee.data.value.id" section="family" :can-edit="canEditProfile" />
            <ProfileSectionCard :employee-id="employee.data.value.id" section="education" :can-edit="canEditProfile" />
            <ProfileSectionCard class="2xl:col-span-2" :employee-id="employee.data.value.id" section="experience" :can-edit="canEditProfile" :joining-date="employee.data.value.dateOfJoining" />
          </div>

          <DocumentsCard v-else-if="tab === 'documents' && showDocuments" :employee-id="employee.data.value.id" :self-service="isSelf" />

          <AppCard v-else title="History" :icon="History" description="Joining and every lifecycle change, newest first.">
            <AppSkeleton v-if="history.loading.value && !history.data.value" :lines="4" />
            <AppErrorState v-else-if="history.error.value" :error="history.error.value" @retry="history.run" />
            <AppEmptyState v-else-if="!history.data.value?.length" compact :icon="History" title="No lifecycle events yet" description="Transfers, promotions, manager and status changes appear here." />
            <EmployeeHistoryTimeline v-else :events="history.data.value" />
          </AppCard>
        </AppTabs>

        <aside class="min-w-0 space-y-4" aria-label="Employee summary">
          <AppCard title="Reporting line" :icon="Network">
            <template #actions>
              <RouterLink :to="{ path: '/hr/org-chart', query: { focus: employee.data.value.id } }" class="text-xs font-medium text-accent-fg hover:underline">Org chart</RouterLink>
            </template>
            <ol>
              <li v-if="employee.data.value.manager">
                <RouterLink :to="`/hr/employees/${employee.data.value.manager.id}`" class="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-muted">
                  <AppAvatar :name="employee.data.value.manager.name" size="md" />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-fg">{{ employee.data.value.manager.name }}</span>
                    <span class="block text-xs text-fg-muted">Manager · <span class="font-mono">{{ employee.data.value.manager.employeeCode }}</span></span>
                  </span>
                </RouterLink>
              </li>
              <li v-if="employee.data.value.manager" class="ms-[18px] h-4 border-s-2 border-dashed border-line" aria-hidden="true" />
              <li class="flex items-center gap-3 rounded-lg bg-accent-soft/50 px-2 py-1.5 ring-1 ring-brand-500/20 -mx-2" aria-current="true">
                <AppAvatar :name="employee.data.value.fullName" :src="employee.data.value.avatarUrl" size="md" />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-fg">{{ employee.data.value.fullName }}</span>
                  <span class="block truncate text-xs text-fg-muted">{{ employee.data.value.designation?.name ?? employee.data.value.employeeCode }}</span>
                </span>
              </li>
            </ol>
            <div class="mt-4">
              <p class="mb-1 flex items-center justify-between text-xs font-medium text-fg-muted">
                Direct reports <span class="tabular-nums">{{ employee.data.value.directReports.length }}</span>
              </p>
              <p v-if="!employee.data.value.directReports.length" class="rounded-lg bg-surface-muted/60 px-3 py-2.5 text-xs text-fg-muted">No one reports to {{ employee.data.value.firstName }}.</p>
              <ul v-else class="-mx-2 max-h-72 overflow-y-auto">
                <li v-for="r in employee.data.value.directReports" :key="r.id">
                  <RouterLink :to="`/hr/employees/${r.id}`" class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-muted">
                    <AppAvatar :name="r.name" size="sm" :class="r.status === 'EXITED' && 'opacity-60 grayscale'" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-fg">{{ r.name }}</span>
                      <span class="block truncate text-xs text-fg-muted">{{ r.designation?.name ?? r.employeeCode }}</span>
                    </span>
                    <AppBadge v-if="r.status !== 'ACTIVE'" :tone="employeeStatusTone[r.status]" size="sm">{{ EMPLOYEE_STATUS_LABELS[r.status] }}</AppBadge>
                  </RouterLink>
                </li>
              </ul>
            </div>
          </AppCard>

          <AppCard title="Key dates" :icon="CalendarDays">
            <ol class="relative space-y-4 border-s border-line ps-5">
              <li v-for="d in keyDates" :key="d.key" class="relative">
                <span :class="['absolute -start-[29px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-surface', d.dot]" aria-hidden="true">
                  <component :is="d.icon" :size="9" class="text-white" />
                </span>
                <p class="text-sm font-medium text-fg">{{ d.label }}</p>
                <p class="text-xs text-fg-muted">{{ formatDate(d.date) }} · {{ d.sub }}</p>
              </li>
            </ol>
          </AppCard>

          <AppCard title="Record check" :icon="ShieldCheck">
            <div class="flex items-center gap-3">
              <svg class="h-12 w-12 shrink-0 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" fill="none" stroke-width="4" class="stroke-line" />
                <circle cx="22" cy="22" r="18" fill="none" stroke-width="4" stroke-linecap="round" :class="['stroke-current transition-[stroke-dashoffset] duration-700', ringTone]" :stroke-dasharray="CIRCUMFERENCE" :stroke-dashoffset="CIRCUMFERENCE * (1 - completeness / 100)" />
              </svg>
              <div class="min-w-0">
                <p class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ completeness }}%</p>
                <p class="text-xs text-fg-muted">{{ missing.length ? `${missing.length} item${missing.length === 1 ? '' : 's'} missing` : 'Record is complete' }}</p>
              </div>
            </div>
            <ul v-if="missing.length" class="mt-3 space-y-1">
              <li v-for="m in missing" :key="m.label" class="flex items-center gap-2.5 text-sm text-fg">
                <span class="h-4 w-4 shrink-0 rounded-full border-2 border-dashed border-line-strong" aria-hidden="true" />{{ m.label }}<span class="sr-only"> (missing)</span>
              </li>
            </ul>
            <p v-else class="mt-3 flex items-center gap-2 text-sm text-success-fg"><Check :size="14" aria-hidden="true" />Everything HR needs is on file.</p>
            <AppButton v-if="missing.length && auth.can('employee.update')" class="mt-3 w-full" size="sm" variant="secondary" :icon="Pencil" :to="`/hr/employees/${employee.data.value.id}/edit`">Update record</AppButton>
          </AppCard>

          <AppCard title="Sign-in account" :icon="KeyRound">
            <div v-if="employee.data.value.account" class="flex items-center justify-between gap-3 text-sm">
              <span class="min-w-0 truncate text-fg" :title="employee.data.value.account.email ?? undefined">{{ employee.data.value.account.email }}</span>
              <AppBadge :tone="membershipTone[employee.data.value.account.status]" dot>{{ statusLabel(employee.data.value.account.status) }}</AppBadge>
            </div>
            <p v-else class="text-sm text-fg-muted">Not linked to a user account, so they can't sign in or use self-service yet.</p>
          </AppCard>

          <AppCard title="Recent activity" :icon="History">
            <template v-if="(history.data.value?.length ?? 0) > 3" #actions>
              <button type="button" class="text-xs font-medium text-accent-fg hover:underline" @click="tab = 'history'">View all</button>
            </template>
            <AppSkeleton v-if="history.loading.value && !history.data.value" :lines="3" />
            <p v-else-if="!history.data.value?.length" class="text-sm text-fg-muted">No lifecycle events yet.</p>
            <EmployeeHistoryTimeline v-else :events="history.data.value.slice(0, 3)" compact />
          </AppCard>
        </aside>
      </div>

      <LifecycleModal v-if="action" :open="!!action" :employee="employee.data.value" :action="action" @close="action = null" @saved="onLifecycleSaved" />
    </template>
  </div>
</template>
