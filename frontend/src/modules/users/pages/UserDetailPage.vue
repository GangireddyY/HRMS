<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft,
  Ban,
  CalendarCheck,
  Clock,
  History,
  IdCard,
  LogIn,
  LogOut,
  Mail,
  MailCheck,
  Monitor,
  Phone,
  RotateCcw,
  Save,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
} from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import { rolesApi } from '@/modules/roles/api/roles.api';
import { roleVisual } from '@/modules/roles/utils/role-visuals';
import { usersApi } from '@/modules/users/api/users.api';
import type { LoginEventRow } from '@/modules/audit/types';
import RolePicker from '@/modules/users/components/RolePicker.vue';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppErrorState, AppSkeleton, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { describeUserAgent, formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';
import { profileCover } from '@/shared/utils/profile-cover';
import { loginTone, membershipTone, statusLabel } from '@/shared/utils/status';

/** One user account: identity header, roles, sign-in history, account facts and a separated danger zone. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const member = useAsync(() => usersApi.get(id.value));
const roles = useAsync(() => rolesApi.list());
const history = auth.can('audit.login_history.view') ? useTable((q) => usersApi.loginHistory(id.value, q), { pageSize: 10, url: false }) : null;

const selectedRoles = ref<string[]>([]);
const busy = ref<string | null>(null);
watch(member.data, (m) => m && (selectedRoles.value = m.roles.map((r) => r.id)), { immediate: true });

const isSelf = computed(() => member.data.value?.userId === auth.user?.id);
const rolesDirty = computed(() => {
  const current = member.data.value?.roles.map((r) => r.id).sort().join(',') ?? '';
  return current !== [...selectedRoles.value].sort().join(',');
});
const name = computed(() => (member.data.value ? `${member.data.value.firstName} ${member.data.value.lastName}` : ''));
const headline = computed(() => member.data.value?.roles.map((r) => r.name).join(' · ') || 'No role assigned');

/** Same cover as the person's card in the Users grid. */
const cover = computed(() => profileCover(member.data.value?.email ?? ''));

async function act(key: string, fn: () => Promise<unknown>, success: string) {
  busy.value = key;
  try {
    await fn();
    feedback.success(success);
    await member.run();
  } catch (e) {
    feedback.error('Action failed', e);
  } finally {
    busy.value = null;
  }
}

const saveRoles = () => act('roles', async () => (member.data.value = await usersApi.setRoles(id.value, selectedRoles.value)), 'Roles updated');
const discardRoles = () => (selectedRoles.value = member.data.value?.roles.map((r) => r.id) ?? []);

async function suspend() {
  const m = member.data.value!;
  if (!(await feedback.confirm({ title: `Suspend ${m.firstName}?`, message: 'They will be signed out immediately and lose access to this organization until reactivated.', confirmLabel: 'Suspend', danger: true }))) return;
  await act('suspend', () => usersApi.suspend(id.value), 'User suspended');
}

const reactivate = () => act('reactivate', () => usersApi.reactivate(id.value), 'User reactivated');
const resend = () => act('resend', () => usersApi.resendInvitation(id.value), 'Invitation resent');

async function revokeSessions() {
  if (!(await feedback.confirm({ title: 'Sign out all sessions?', message: 'All of this user\'s sessions in this organization will end now.', confirmLabel: 'Sign out', danger: true }))) return;
  await act('revoke', () => usersApi.revokeSessions(id.value), 'Sessions revoked');
}

async function cancelInvite() {
  if (!(await feedback.confirm({ title: 'Cancel invitation?', message: 'The invitation link will stop working.', confirmLabel: 'Cancel invitation', danger: true }))) return;
  busy.value = 'cancel';
  try {
    await usersApi.cancelInvitation(id.value);
    feedback.success('Invitation cancelled');
    await router.replace('/admin/users');
  } catch (e) {
    feedback.error('Could not cancel invitation', e);
  } finally {
    busy.value = null;
  }
}

/** Creates the employee record from the account and opens it so HR can complete department, manager and shift. */
async function createEmployee() {
  busy.value = 'employee';
  try {
    const res = await employeesApi.createFromMembers([id.value]);
    feedback.success('Employee record created', `${res.employees[0]!.fullName} · ${res.employees[0]!.employeeCode}`);
    await router.push(`/hr/employees/${res.employees[0]!.id}/edit`);
  } catch (e) {
    feedback.error('Could not create employee record', e);
  } finally {
    busy.value = null;
  }
}

// ---- Danger zone -----------------------------------------------------------------------------------------------
const canRevoke = computed(() => auth.can('user.sessions.revoke') && member.data.value?.status === 'ACTIVE');
const canSuspend = computed(() => auth.can('user.update') && member.data.value?.status === 'ACTIVE');
const canCancelInvite = computed(() => auth.can('user.invite') && member.data.value?.status === 'INVITED');
const showDanger = computed(() => !isSelf.value && (canRevoke.value || canSuspend.value || canCancelInvite.value));

// ---- Key dates -------------------------------------------------------------------------------------------------
const timeline = computed(() => {
  const m = member.data.value;
  if (!m) return [];
  const events: { label: string; at: string | null; icon: Component; tone: string }[] = [
    { label: 'Invited', at: m.invitedAt, icon: UserPlus, tone: 'bg-info' },
    { label: 'Joined the organization', at: m.joinedAt, icon: CalendarCheck, tone: 'bg-brand-500' },
    { label: 'Last signed in', at: m.lastLoginAt, icon: LogIn, tone: 'bg-success' },
    { label: 'Suspended', at: m.suspendedAt, icon: Ban, tone: 'bg-danger' },
  ];
  return events.filter((e) => e.at);
});

// ---- Sign-in history -------------------------------------------------------------------------------------------
const historyColumns: TableColumn<LoginEventRow>[] = [
  { key: 'createdAt', label: 'When' },
  { key: 'outcome', label: 'Result' },
  { key: 'device', label: 'Device' },
  { key: 'ipAddress', label: 'IP address' },
];
const isMobile = (ua: string | null) => !!ua && /Android|iPhone|iPad|Mobile/i.test(ua);
/** The newest attempts on the first page, oldest first, for the activity ticks in the card header. */
const recent = computed(() => (history && history.page.value === 1 ? [...history.rows.value].reverse() : []));
const recentFailures = computed(() => recent.value.filter((r) => r.outcome === 'FAILURE' || r.outcome === 'LOCKED').length);
</script>

<template>
  <div>
    <AppSkeleton v-if="member.loading.value && !member.data.value" :lines="6" />
    <AppErrorState v-else-if="member.error.value" :error="member.error.value" title="Could not load user" @retry="member.run" />
    <template v-else-if="member.data.value">
      <RouterLink to="/admin/users" class="group mb-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-fg-muted transition hover:text-fg">
        <ArrowLeft :size="13" class="transition group-hover:-translate-x-0.5" aria-hidden="true" /> All users
      </RouterLink>

      <!-- Identity header -->
      <section class="card mb-4 overflow-hidden" aria-labelledby="user-name">
        <div class="h-24 border-b border-line/50" :style="cover" aria-hidden="true" />
        <div class="flex flex-wrap items-end gap-x-5 gap-y-4 px-5 pb-5">
          <div class="relative z-10 -mt-12 rounded-full bg-surface p-1 shadow-sm">
            <AppAvatar :name="name" :src="member.data.value.avatarUrl" size="2xl" />
          </div>
          <div class="min-w-0 flex-1 pt-3">
            <div class="flex flex-wrap items-center gap-2">
              <h1 id="user-name" class="truncate text-xl font-semibold tracking-tight text-fg lg:text-2xl">{{ name }}</h1>
              <AppBadge :tone="membershipTone[member.data.value.status]" dot>{{ statusLabel(member.data.value.status) }}</AppBadge>
              <AppBadge v-if="isSelf" tone="info">You</AppBadge>
            </div>
            <p class="mt-0.5 truncate text-sm text-fg-muted">{{ headline }}</p>
            <ul class="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
              <li class="inline-flex min-w-0 items-center gap-1.5"><Mail :size="13" aria-hidden="true" /><span class="truncate text-fg">{{ member.data.value.email }}</span></li>
              <li :class="['inline-flex items-center gap-1.5', member.data.value.mfaEnabled ? 'text-success-fg' : '']">
                <component :is="member.data.value.mfaEnabled ? ShieldCheck : ShieldOff" :size="13" aria-hidden="true" />2FA {{ member.data.value.mfaEnabled ? 'enabled' : 'not enabled' }}
              </li>
              <li class="inline-flex items-center gap-1.5" :title="formatDateTime(member.data.value.lastLoginAt)">
                <Clock :size="13" aria-hidden="true" />{{ member.data.value.lastLoginAt ? `Signed in ${timeAgo(member.data.value.lastLoginAt)}` : 'Never signed in' }}
              </li>
              <li v-if="member.data.value.joinedAt" class="inline-flex items-center gap-1.5"><CalendarCheck :size="13" aria-hidden="true" />Member since {{ formatDate(member.data.value.joinedAt) }}</li>
            </ul>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <AppButton
              v-if="member.data.value.employee && auth.hasFeature('employee') && auth.can('employee.view')"
              variant="secondary"
              :icon="IdCard"
              :to="`/hr/employees/${member.data.value.employee.id}`"
            >
              Employee profile
            </AppButton>
            <template v-if="!isSelf">
              <AppButton v-if="member.data.value.status === 'INVITED' && auth.can('user.invite')" variant="secondary" :icon="Mail" :loading="busy === 'resend'" @click="resend">Resend invitation</AppButton>
              <AppButton v-if="member.data.value.status === 'SUSPENDED' && auth.can('user.update')" :icon="RotateCcw" :loading="busy === 'reactivate'" @click="reactivate">Reactivate</AppButton>
            </template>
          </div>
        </div>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-w-0 space-y-4">
          <!-- Roles -->
          <AppCard title="Roles" :icon="ShieldCheck" description="Effective access is the union of all assigned roles.">
            <template #actions><AppBadge tone="brand">{{ member.data.value.roles.length }} assigned</AppBadge></template>
            <AppSkeleton v-if="roles.loading.value" :lines="5" />
            <AppErrorState v-else-if="roles.error.value" :error="roles.error.value" @retry="roles.run" />
            <template v-else-if="auth.can('user.update') && !isSelf && roles.data.value">
              <RolePicker v-model="selectedRoles" :roles="roles.data.value" :error="selectedRoles.length ? undefined : 'Select at least one role'" />
              <div class="-mx-4 -mb-4 mt-4 flex flex-wrap items-center gap-3 border-t border-line/70 bg-surface-muted/40 px-4 py-3">
                <p v-if="rolesDirty" class="me-auto inline-flex items-center gap-2 text-sm text-fg"><span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />Unsaved role changes</p>
                <p v-else class="me-auto text-xs text-fg-muted">{{ selectedRoles.length }} {{ selectedRoles.length === 1 ? 'role' : 'roles' }} selected</p>
                <AppButton v-if="rolesDirty" variant="ghost" size="sm" :disabled="busy === 'roles'" @click="discardRoles">Discard</AppButton>
                <AppButton size="sm" :icon="Save" :loading="busy === 'roles'" :disabled="!rolesDirty || !selectedRoles.length" @click="saveRoles">Save roles</AppButton>
              </div>
            </template>
            <template v-else>
              <ul v-if="member.data.value.roles.length" class="grid gap-2 sm:grid-cols-2">
                <li v-for="r in member.data.value.roles" :key="r.id">
                  <component
                    :is="auth.can('role.view') ? RouterLink : 'div'"
                    :to="auth.can('role.view') ? `/admin/roles/${r.id}` : undefined"
                    :class="['flex items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ring-line ring-inset', auth.can('role.view') && 'transition hover:bg-surface-muted/60']"
                  >
                    <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', roleVisual(r.key).tile]" aria-hidden="true"><component :is="roleVisual(r.key).icon" :size="16" /></span>
                    <span class="truncate text-sm font-medium text-fg">{{ r.name }}</span>
                  </component>
                </li>
              </ul>
              <p v-else class="text-sm text-fg-muted">No roles assigned.</p>
              <p v-if="isSelf" class="mt-3 text-xs text-fg-muted">You cannot change your own roles.</p>
            </template>
          </AppCard>

          <!-- Sign-in history -->
          <AppCard v-if="history" title="Sign-in history" :icon="History" description="Every sign-in attempt to this organization, newest first." :padded="false">
            <template v-if="recent.length" #actions>
              <div class="flex items-center gap-2 text-xs text-fg-muted">
                <span class="flex items-end gap-0.5" aria-hidden="true">
                  <span v-for="r in recent" :key="r.id" :class="['h-4 w-1.5 rounded-full', r.outcome === 'SUCCESS' ? 'bg-success/70' : r.outcome === 'MFA_CHALLENGE' ? 'bg-info/70' : 'bg-danger']" :title="`${statusLabel(r.outcome)} · ${formatDateTime(r.createdAt)}`" />
                </span>
                <span class="tabular-nums">{{ recentFailures ? `${recentFailures} failed of last ${recent.length}` : `Last ${recent.length} attempts OK` }}</span>
              </div>
            </template>
            <AppDataTable
              :columns="historyColumns"
              :rows="history.rows.value"
              :loading="history.loading.value"
              :error="history.error.value"
              :meta="history.meta.value"
              :grid="false"
              empty-title="No sign-in activity"
              empty-description="Attempts appear here once this person signs in."
              caption="User sign-in history"
              :filtered="history.isFiltered.value"
              @page="history.setPage"
              @retry="history.load"
              @clear="history.clearFilters()"
            >
              <template #cell-createdAt="{ row }">
                <p class="text-fg">{{ timeAgo(row.createdAt) }}</p>
                <p class="text-xs text-fg-muted">{{ formatDateTime(row.createdAt) }}</p>
              </template>
              <template #cell-outcome="{ row }">
                <AppBadge :tone="loginTone[row.outcome]" dot>{{ statusLabel(row.outcome) }}</AppBadge>
                <p v-if="row.failureReason" class="mt-1 text-xs text-fg-muted">{{ statusLabel(row.failureReason) }}</p>
              </template>
              <template #cell-device="{ row }">
                <span class="inline-flex items-center gap-2 text-fg">
                  <component :is="isMobile(row.userAgent) ? Smartphone : Monitor" :size="15" class="text-fg-subtle" aria-hidden="true" />{{ describeUserAgent(row.userAgent) }}
                </span>
              </template>
              <template #cell-ipAddress="{ row }"><span class="font-mono text-xs text-fg-muted">{{ row.ipAddress ?? '—' }}</span></template>
            </AppDataTable>
          </AppCard>

          <!-- Danger zone -->
          <section v-if="showDanger" class="card overflow-hidden ring-1 ring-danger/25" aria-labelledby="danger-title">
            <header class="flex items-center gap-3 border-b border-danger/15 bg-danger-soft/40 px-4 py-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger-fg" aria-hidden="true"><TriangleAlert :size="16" /></span>
              <div>
                <h2 id="danger-title" class="text-sm font-semibold text-fg">Danger zone</h2>
                <p class="text-xs text-fg-muted">These actions affect {{ member.data.value.firstName }}’s access right away.</p>
              </div>
            </header>
            <ul class="divide-y divide-line/70">
              <li v-if="canRevoke" class="flex flex-wrap items-center gap-4 px-4 py-4">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg">Sign out of all sessions</p>
                  <p class="text-xs text-fg-muted">Ends every session in this organization on all devices. They can sign in again.</p>
                </div>
                <AppButton variant="secondary" :icon="LogOut" :loading="busy === 'revoke'" @click="revokeSessions">Sign out sessions</AppButton>
              </li>
              <li v-if="canSuspend" class="flex flex-wrap items-center gap-4 px-4 py-4">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg">Suspend access</p>
                  <p class="text-xs text-fg-muted">Signs them out and blocks access to this organization until reactivated. Their data is kept.</p>
                </div>
                <AppButton variant="danger" :icon="Ban" :loading="busy === 'suspend'" @click="suspend">Suspend</AppButton>
              </li>
              <li v-if="canCancelInvite" class="flex flex-wrap items-center gap-4 px-4 py-4">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg">Cancel invitation</p>
                  <p class="text-xs text-fg-muted">The invitation link stops working and they won’t be able to join with it.</p>
                </div>
                <AppButton variant="danger" :icon="Trash2" :loading="busy === 'cancel'" @click="cancelInvite">Cancel invitation</AppButton>
              </li>
            </ul>
          </section>
        </div>

        <aside class="space-y-4">
          <!-- Account -->
          <AppCard title="Account">
            <dl class="space-y-3 text-sm">
              <div class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><Mail :size="14" /></span>
                <div class="min-w-0"><dt class="text-2xs font-medium text-fg-muted">Email</dt><dd class="truncate text-fg" :title="member.data.value.email">{{ member.data.value.email }}</dd></div>
              </div>
              <div class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><Phone :size="14" /></span>
                <div class="min-w-0"><dt class="text-2xs font-medium text-fg-muted">Phone</dt><dd class="text-fg">{{ member.data.value.phone ?? '—' }}</dd></div>
              </div>
              <div class="flex items-start gap-3">
                <span :class="['mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', member.data.value.mfaEnabled ? 'bg-success-soft text-success-fg' : 'bg-warning-soft text-warning-fg']" aria-hidden="true">
                  <component :is="member.data.value.mfaEnabled ? ShieldCheck : ShieldOff" :size="14" />
                </span>
                <div class="min-w-0">
                  <dt class="text-2xs font-medium text-fg-muted">Two-factor authentication</dt>
                  <dd class="text-fg">{{ member.data.value.mfaEnabled ? 'Enabled' : 'Not enabled' }}</dd>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><UserRound :size="14" /></span>
                <div class="min-w-0">
                  <dt class="text-2xs font-medium text-fg-muted">Sign-in account</dt>
                  <dd class="text-fg">{{ member.data.value.accountStatus === 'ACTIVE' ? 'Active' : 'Disabled on the platform' }}</dd>
                </div>
              </div>
            </dl>
          </AppCard>

          <!-- Employee record -->
          <AppCard v-if="auth.hasFeature('employee')" title="Employee record">
            <div v-if="member.data.value.employee" class="flex items-center gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg ring-1 ring-brand-600/15 ring-inset" aria-hidden="true"><IdCard :size="16" /></span>
              <div class="min-w-0 flex-1">
                <p class="text-2xs font-medium text-fg-muted">Linked employee</p>
                <RouterLink v-if="auth.can('employee.view')" :to="`/hr/employees/${member.data.value.employee.id}`" class="font-mono text-sm font-medium text-accent-fg hover:underline">
                  {{ member.data.value.employee.employeeCode }}
                </RouterLink>
                <p v-else class="font-mono text-sm text-fg">{{ member.data.value.employee.employeeCode }}</p>
              </div>
            </div>
            <div v-else class="space-y-3">
              <p class="text-sm text-fg-muted">This account isn’t linked to an employee record, so it has no HR profile, leave or payroll.</p>
              <AppButton v-if="auth.can('employee.create') && member.data.value.status !== 'SUSPENDED'" size="sm" variant="secondary" :icon="IdCard" :loading="busy === 'employee'" @click="createEmployee">
                Create employee record
              </AppButton>
            </div>
          </AppCard>

          <!-- Key dates -->
          <AppCard title="Activity">
            <ol v-if="timeline.length" class="relative space-y-4 border-s border-line ps-5">
              <li v-for="t in timeline" :key="t.label" class="relative">
                <span :class="['absolute -start-[29px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-surface', t.tone]" aria-hidden="true"><component :is="t.icon" :size="9" class="text-white" /></span>
                <p class="text-sm font-medium text-fg">{{ t.label }}</p>
                <p class="text-xs text-fg-muted">{{ formatDateTime(t.at) }} · {{ timeAgo(t.at) }}</p>
              </li>
            </ol>
            <p v-else class="text-sm text-fg-muted">No activity yet.</p>
            <p v-if="member.data.value.status === 'INVITED'" class="mt-4 flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info-fg">
              <MailCheck :size="14" class="mt-px shrink-0" aria-hidden="true" />Waiting for {{ member.data.value.firstName }} to accept the invitation.
            </p>
          </AppCard>
        </aside>
      </div>
    </template>
  </div>
</template>
