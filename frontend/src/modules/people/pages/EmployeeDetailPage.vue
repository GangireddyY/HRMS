<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightLeft, BadgeCheck, ChevronDown, Network, Pencil, TrendingUp, Trash2, UserCog, UserRound, Workflow } from '@lucide/vue';
import type { LifecycleAction } from '@contracts';
import { employeesApi } from '@/modules/people/api/people.api';
import DocumentsCard from '@/modules/people/components/DocumentsCard.vue';
import LifecycleModal from '@/modules/people/components/LifecycleModal.vue';
import ProfileSectionCard from '@/modules/people/components/ProfileSectionCard.vue';
import SensitiveDetailsCard from '@/modules/people/components/SensitiveDetailsCard.vue';
import {
  CHANGE_FIELD_LABELS,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  GENDER_LABELS,
  LIFECYCLE_LABELS,
  MARITAL_STATUS_LABELS,
  employeeStatusTone,
} from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDropdown, AppEmptyState, AppErrorState, AppMenuItem, AppPageHeader, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';
import { COUNTRY_OPTIONS } from '@/shared/utils/options';
import { membershipTone, statusLabel } from '@/shared/utils/status';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const employee = useAsync(() => employeesApi.get(id.value));
const history = useAsync(() => employeesApi.history(id.value));
const me = useAsync(() => employeesApi.me());
watch(id, () => {
  void employee.run();
  void history.run();
});

const isSelf = computed(() => !!me.data.value && me.data.value.id === id.value);
const canEditProfile = computed(() => auth.can('employee.update') || (isSelf.value && auth.can('self.profile.update')));
const showDocuments = computed(() => isSelf.value || auth.can('employee.document.manage'));

const tab = ref((route.query.tab as string) || 'overview');
const tabs = computed(() => [
  { key: 'overview', label: 'Overview' },
  { key: 'profile', label: 'Family & background' },
  ...(showDocuments.value ? [{ key: 'documents', label: 'Documents' }] : []),
  { key: 'history', label: 'History' },
]);
watch(tab, (t) => void router.replace({ query: { ...route.query, tab: t === 'overview' ? undefined : t } }));

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

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const country = (code: string | null) => (code ? (COUNTRY_OPTIONS.find((c) => c.value === code)?.label ?? code) : '—');
</script>

<template>
  <div>
    <AppSkeleton v-if="employee.loading.value && !employee.data.value" :lines="8" />
    <AppErrorState v-else-if="employee.error.value" :error="employee.error.value" title="Could not load employee" @retry="employee.run" />
    <template v-else-if="employee.data.value">
      <AppPageHeader
        :title="employee.data.value.fullName"
        :description="[employee.data.value.designation?.name, employee.data.value.department?.name].filter(Boolean).join(' · ') || EMPLOYMENT_TYPE_LABELS[employee.data.value.employmentType]"
        back="/hr/employees"
        back-label="All employees"
      >
        <template #leading><AppAvatar :name="employee.data.value.fullName" :src="employee.data.value.avatarUrl" size="xl" /></template>
        <template #badges>
          <AppBadge :tone="employeeStatusTone[employee.data.value.status]" dot>{{ EMPLOYEE_STATUS_LABELS[employee.data.value.status] }}</AppBadge>
          <AppBadge>{{ employee.data.value.employeeCode }}</AppBadge>
          <AppBadge v-if="employee.data.value.grade" tone="violet">{{ employee.data.value.grade.name }}</AppBadge>
        </template>
        <template #actions>
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
          <AppButton v-if="auth.can('employee.delete')" variant="ghost" :icon="Trash2" aria-label="Delete employee" @click="remove" />
        </template>
      </AppPageHeader>

      <AppTabs v-model="tab" :tabs="tabs">
        <div v-if="tab === 'overview'" class="grid items-start gap-4 lg:grid-cols-3">
          <div class="space-y-4 lg:col-span-2">
            <AppCard title="Employment">
              <dl class="grid gap-x-4 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div><dt class="text-xs text-fg-muted">Designation</dt><dd class="mt-0.5 text-fg">{{ show(employee.data.value.designation?.name) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Department</dt><dd class="mt-0.5 text-fg">{{ show(employee.data.value.department?.name) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Location</dt><dd class="mt-0.5 text-fg">{{ show(employee.data.value.location?.name) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Grade</dt><dd class="mt-0.5 text-fg">{{ show(employee.data.value.grade?.name) }}</dd></div>
                <div>
                  <dt class="text-xs text-fg-muted">Cost center</dt>
                  <dd class="mt-0.5 text-fg">{{ employee.data.value.costCenter ? `${employee.data.value.costCenter.code} – ${employee.data.value.costCenter.name}` : '—' }}</dd>
                </div>
                <div><dt class="text-xs text-fg-muted">Shift</dt><dd class="mt-0.5 text-fg">{{ employee.data.value.shift?.name ?? 'Default shift' }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Employment type</dt><dd class="mt-0.5 text-fg">{{ EMPLOYMENT_TYPE_LABELS[employee.data.value.employmentType] }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Date of joining</dt><dd class="mt-0.5 text-fg">{{ formatDate(employee.data.value.dateOfJoining) }}</dd></div>
                <div>
                  <dt class="text-xs text-fg-muted">Probation</dt>
                  <dd class="mt-0.5 text-fg">
                    <template v-if="employee.data.value.confirmedOn">Confirmed {{ formatDate(employee.data.value.confirmedOn) }}</template>
                    <template v-else-if="employee.data.value.probationEndDate">Ends {{ formatDate(employee.data.value.probationEndDate) }}</template>
                    <template v-else>—</template>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-fg-muted">Notice period</dt>
                  <dd class="mt-0.5 text-fg">{{ employee.data.value.noticePeriodDays === null ? '—' : `${employee.data.value.noticePeriodDays} days` }}</dd>
                </div>
                <div v-if="employee.data.value.exitDate"><dt class="text-xs text-fg-muted">Exit date</dt><dd class="mt-0.5 text-fg">{{ formatDate(employee.data.value.exitDate) }}</dd></div>
              </dl>
            </AppCard>

            <AppCard title="Personal & contact">
              <dl class="grid gap-x-4 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div><dt class="text-xs text-fg-muted">Work email</dt><dd class="mt-0.5 break-all text-fg">{{ show(employee.data.value.workEmail) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Personal email</dt><dd class="mt-0.5 break-all text-fg">{{ show(employee.data.value.personalEmail) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Phone</dt><dd class="mt-0.5 text-fg">{{ show(employee.data.value.phone) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Date of birth</dt><dd class="mt-0.5 text-fg">{{ employee.data.value.dateOfBirth ? formatDate(employee.data.value.dateOfBirth) : '—' }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Gender</dt><dd class="mt-0.5 text-fg">{{ employee.data.value.gender ? GENDER_LABELS[employee.data.value.gender] : '—' }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Marital status</dt><dd class="mt-0.5 text-fg">{{ employee.data.value.maritalStatus ? MARITAL_STATUS_LABELS[employee.data.value.maritalStatus] : '—' }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Blood group</dt><dd class="mt-0.5 text-fg">{{ show(employee.data.value.bloodGroup) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Nationality</dt><dd class="mt-0.5 text-fg">{{ country(employee.data.value.nationality) }}</dd></div>
                <div><dt class="text-xs text-fg-muted">Emergency contact</dt><dd class="mt-0.5 text-fg">{{ [employee.data.value.emergencyContactName, employee.data.value.emergencyContactPhone].filter(Boolean).join(' · ') || '—' }}</dd></div>
                <div class="sm:col-span-2 xl:col-span-3"><dt class="text-xs text-fg-muted">Current address</dt><dd class="mt-0.5 whitespace-pre-line text-fg">{{ show(employee.data.value.address) }}</dd></div>
                <div class="sm:col-span-2 xl:col-span-3">
                  <dt class="text-xs text-fg-muted">Permanent address</dt>
                  <dd class="mt-0.5 whitespace-pre-line text-fg">{{ employee.data.value.permanentAddress ?? (employee.data.value.address ? 'Same as current address' : '—') }}</dd>
                </div>
              </dl>
            </AppCard>
          </div>

          <div class="space-y-4">
            <AppCard title="Reporting">
              <div class="text-sm">
                <p class="text-xs text-fg-muted">Reports to</p>
                <RouterLink v-if="employee.data.value.manager" :to="`/hr/employees/${employee.data.value.manager.id}`" class="mt-2 -m-2 flex items-center gap-3 rounded-lg p-2 hover:bg-surface-muted">
                  <AppAvatar :name="employee.data.value.manager.name" size="sm" />
                  <span class="font-medium text-fg">{{ employee.data.value.manager.name }}</span>
                </RouterLink>
                <p v-else class="mt-1 text-fg-muted">No manager</p>
              </div>
              <div class="mt-4 text-sm">
                <p class="text-xs text-fg-muted">Direct reports ({{ employee.data.value.directReports.length }})</p>
                <AppEmptyState v-if="!employee.data.value.directReports.length" compact :icon="UserRound" title="No direct reports" />
                <ul v-else class="mt-2 space-y-1">
                  <li v-for="r in employee.data.value.directReports" :key="r.id">
                    <RouterLink :to="`/hr/employees/${r.id}`" class="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-muted">
                      <AppAvatar :name="r.name" size="sm" />
                      <span class="min-w-0">
                        <span class="block truncate font-medium text-fg">{{ r.name }}</span>
                        <span class="block truncate text-xs text-fg-muted">{{ r.designation?.name ?? r.employeeCode }}</span>
                      </span>
                    </RouterLink>
                  </li>
                </ul>
              </div>
            </AppCard>

            <AppCard title="User account">
              <div v-if="employee.data.value.account" class="flex items-center justify-between gap-3 text-sm">
                <span class="min-w-0 truncate text-fg">{{ employee.data.value.account.email }}</span>
                <AppBadge :tone="membershipTone[employee.data.value.account.status]" dot>{{ statusLabel(employee.data.value.account.status) }}</AppBadge>
              </div>
              <p v-else class="text-sm text-fg-muted">Not linked to a user account, so they can't sign in or use self-service yet.</p>
            </AppCard>

            <SensitiveDetailsCard
              v-if="auth.can('employee.sensitive.view')"
              :employee-id="employee.data.value.id"
              :has-bank-account="employee.data.value.hasBankAccount"
              :can-edit="auth.can('employee.update')"
            />
          </div>
        </div>

        <div v-else-if="tab === 'profile'" class="grid items-start gap-4 xl:grid-cols-2">
          <ProfileSectionCard :employee-id="employee.data.value.id" section="family" :can-edit="canEditProfile" />
          <ProfileSectionCard :employee-id="employee.data.value.id" section="education" :can-edit="canEditProfile" />
          <ProfileSectionCard class="xl:col-span-2" :employee-id="employee.data.value.id" section="experience" :can-edit="canEditProfile" :joining-date="employee.data.value.dateOfJoining" />
        </div>

        <DocumentsCard v-else-if="tab === 'documents' && showDocuments" :employee-id="employee.data.value.id" :self-service="isSelf" />

        <AppCard v-else title="History" description="Joining and every lifecycle change, newest first.">
          <AppSkeleton v-if="history.loading.value && !history.data.value" :lines="4" />
          <AppErrorState v-else-if="history.error.value" :error="history.error.value" @retry="history.run" />
          <ol v-else class="relative space-y-5 border-s border-line ps-6">
            <li v-for="e in history.data.value ?? []" :key="e.id" class="relative">
              <span class="absolute top-1 -start-[29px] h-3 w-3 rounded-full border-2 border-surface bg-brand-500 ring-1 ring-brand-500/30" aria-hidden="true" />
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="text-sm font-medium text-fg">{{ LIFECYCLE_LABELS[e.type] }}</p>
                <p class="text-xs text-fg-subtle">Effective {{ formatDate(e.effectiveDate) }}</p>
              </div>
              <ul v-if="Object.keys(e.changes).length" class="mt-1 space-y-0.5 text-sm text-fg-muted">
                <li v-for="(c, field) in e.changes" :key="field">
                  {{ CHANGE_FIELD_LABELS[field] ?? field }}: <span class="text-fg-subtle line-through">{{ c.from === null ? 'none' : field === 'status' ? statusLabel(String(c.from)) : c.from }}</span>
                  → <span class="font-medium text-fg">{{ c.to === null ? 'none' : field === 'status' ? statusLabel(String(c.to)) : c.to }}</span>
                </li>
              </ul>
              <p v-if="e.note" class="mt-1 text-sm text-fg-muted italic">“{{ e.note }}”</p>
              <p class="mt-1 text-xs text-fg-subtle">{{ e.createdBy ? `By ${e.createdBy}` : 'System' }} · {{ formatDateTime(e.createdAt) }}</p>
            </li>
          </ol>
        </AppCard>
      </AppTabs>

      <LifecycleModal v-if="action" :open="!!action" :employee="employee.data.value" :action="action" @close="action = null" @saved="onLifecycleSaved" />
    </template>
  </div>
</template>
