<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Ban, LogOut, Mail, RotateCcw, Save, Trash2 } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import { rolesApi } from '@/modules/roles/api/roles.api';
import { usersApi } from '@/modules/users/api/users.api';
import type { LoginEventRow } from '@/modules/audit/types';
import RolePicker from '@/modules/users/components/RolePicker.vue';
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppErrorState,
  AppPageHeader,
  AppSkeleton,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { describeUserAgent, formatDateTime } from '@/shared/utils/format';
import { loginTone, membershipTone, statusLabel } from '@/shared/utils/status';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const member = useAsync(() => usersApi.get(id.value));
const roles = useAsync(() => rolesApi.list());
const history = auth.can('audit.login_history.view') ? useTable((q) => usersApi.loginHistory(id.value, q), { pageSize: 10 }) : null;

const selectedRoles = ref<string[]>([]);
const busy = ref<string | null>(null);
watch(member.data, (m) => m && (selectedRoles.value = m.roles.map((r) => r.id)), { immediate: true });

const isSelf = computed(() => member.data.value?.userId === auth.user?.id);
const rolesDirty = computed(() => {
  const current = member.data.value?.roles.map((r) => r.id).sort().join(',') ?? '';
  return current !== [...selectedRoles.value].sort().join(',');
});

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

const historyColumns: TableColumn<LoginEventRow>[] = [
  { key: 'createdAt', label: 'When' },
  { key: 'outcome', label: 'Result' },
  { key: 'device', label: 'Device' },
  { key: 'ipAddress', label: 'IP address' },
];
</script>

<template>
  <div>
    <AppSkeleton v-if="member.loading.value && !member.data.value" :lines="6" />
    <AppErrorState v-else-if="member.error.value" :error="member.error.value" title="Could not load user" @retry="member.run" />
    <template v-else-if="member.data.value">
      <AppPageHeader :title="`${member.data.value.firstName} ${member.data.value.lastName}`" :description="member.data.value.email" back="/admin/users" back-label="All users">
        <template #badges>
          <AppBadge :tone="membershipTone[member.data.value.status]" dot>{{ statusLabel(member.data.value.status) }}</AppBadge>
          <AppBadge v-if="isSelf" tone="info">You</AppBadge>
        </template>
        <template v-if="!isSelf" #actions>
          <template v-if="member.data.value.status === 'INVITED' && auth.can('user.invite')">
            <AppButton variant="secondary" :icon="Mail" :loading="busy === 'resend'" @click="resend">Resend invitation</AppButton>
            <AppButton variant="secondary" :icon="Trash2" :loading="busy === 'cancel'" @click="cancelInvite">Cancel invitation</AppButton>
          </template>
          <AppButton v-if="auth.can('user.sessions.revoke') && member.data.value.status === 'ACTIVE'" variant="secondary" :icon="LogOut" :loading="busy === 'revoke'" @click="revokeSessions">Sign out sessions</AppButton>
          <template v-if="auth.can('user.update')">
            <AppButton v-if="member.data.value.status === 'SUSPENDED'" variant="secondary" :icon="RotateCcw" :loading="busy === 'reactivate'" @click="reactivate">Reactivate</AppButton>
            <AppButton v-else-if="member.data.value.status === 'ACTIVE'" variant="danger" :icon="Ban" :loading="busy === 'suspend'" @click="suspend">Suspend</AppButton>
          </template>
        </template>
      </AppPageHeader>

      <div class="grid items-start gap-4 lg:grid-cols-3">
        <AppCard title="Profile">
          <div class="mb-4 flex items-center gap-3">
            <AppAvatar :name="`${member.data.value.firstName} ${member.data.value.lastName}`" :src="member.data.value.avatarUrl" size="lg" />
            <div class="min-w-0">
              <p class="truncate font-medium">{{ member.data.value.firstName }} {{ member.data.value.lastName }}</p>
              <p class="truncate text-sm text-fg-muted">{{ member.data.value.email }}</p>
            </div>
          </div>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Phone</dt><dd>{{ member.data.value.phone ?? '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Two-factor</dt><dd><AppBadge :tone="member.data.value.mfaEnabled ? 'success' : 'neutral'">{{ member.data.value.mfaEnabled ? 'Enabled' : 'Not enabled' }}</AppBadge></dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Invited</dt><dd>{{ formatDateTime(member.data.value.invitedAt) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Joined</dt><dd>{{ formatDateTime(member.data.value.joinedAt) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-fg-muted">Last sign-in</dt><dd>{{ formatDateTime(member.data.value.lastLoginAt) }}</dd></div>
            <div v-if="member.data.value.suspendedAt" class="flex justify-between gap-3"><dt class="text-fg-muted">Suspended</dt><dd>{{ formatDateTime(member.data.value.suspendedAt) }}</dd></div>
            <div v-if="auth.hasFeature('employee')" class="flex items-center justify-between gap-3 border-t border-line/70 pt-3">
              <dt class="text-fg-muted">Employee record</dt>
              <dd>
                <RouterLink v-if="member.data.value.employee && auth.can('employee.view')" :to="`/hr/employees/${member.data.value.employee.id}`" class="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {{ member.data.value.employee.employeeCode }}
                </RouterLink>
                <span v-else-if="member.data.value.employee">{{ member.data.value.employee.employeeCode }}</span>
                <AppButton v-else-if="auth.can('employee.create') && member.data.value.status !== 'SUSPENDED'" size="xs" variant="secondary" :loading="busy === 'employee'" @click="createEmployee">Create employee record</AppButton>
                <span v-else class="text-fg-subtle">None</span>
              </dd>
            </div>
          </dl>
        </AppCard>

        <AppCard class="lg:col-span-2" title="Roles" description="Effective access is the union of all assigned roles.">
          <AppSkeleton v-if="roles.loading.value" :lines="5" />
          <AppErrorState v-else-if="roles.error.value" :error="roles.error.value" @retry="roles.run" />
          <template v-else-if="auth.can('user.update') && !isSelf && roles.data.value">
            <RolePicker v-model="selectedRoles" :roles="roles.data.value" :error="selectedRoles.length ? undefined : 'Select at least one role'" />
            <div class="mt-4 flex justify-end">
              <AppButton :icon="Save" :loading="busy === 'roles'" :disabled="!rolesDirty || !selectedRoles.length" @click="saveRoles">Save roles</AppButton>
            </div>
          </template>
          <div v-else class="flex flex-wrap gap-2">
            <AppBadge v-for="r in member.data.value.roles" :key="r.id" tone="brand">{{ r.name }}</AppBadge>
            <p v-if="isSelf" class="w-full text-xs text-fg-muted">You cannot change your own roles.</p>
          </div>
        </AppCard>
      </div>

      <AppCard v-if="history" class="mt-4" title="Sign-in history" :padded="false">
        <AppDataTable
          :columns="historyColumns"
          :rows="history.rows.value"
          :loading="history.loading.value"
          :error="history.error.value"
          :meta="history.meta.value"
          empty-title="No sign-in activity"
          caption="User sign-in history"
          @page="history.setPage"
          @retry="history.load"
        >
          <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          <template #cell-outcome="{ row }"><AppBadge :tone="loginTone[row.outcome]">{{ statusLabel(row.outcome) }}</AppBadge></template>
          <template #cell-device="{ row }">{{ describeUserAgent(row.userAgent) }}</template>
        </AppDataTable>
      </AppCard>
    </template>
  </div>
</template>
