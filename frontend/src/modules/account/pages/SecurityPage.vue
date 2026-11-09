<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { KeyRound, Laptop, LogOut } from '@lucide/vue';
import { validatePassword } from '@contracts';
import { authApi } from '@/modules/auth/api/auth.api';
import type { LoginEventRow } from '@/modules/audit/types';
import MfaPanel from '@/modules/account/components/MfaPanel.vue';
import LoginEventCard from '@/modules/audit/components/LoginEventCard.vue';
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppErrorState,
  AppInput,
  AppPageHeader,
  AppPasswordChecklist,
  AppSkeleton,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { describeUserAgent, formatDateTime, timeAgo } from '@/shared/utils/format';
import { loginTone, statusLabel } from '@/shared/utils/status';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const policy = useAsync(() => authApi.passwordPolicy());
const sessions = useAsync(() => authApi.sessions());
const history = useTable((q) => authApi.loginHistory(q), { pageSize: 10, url: false });

const pw = reactive({ current: '', next: '', confirm: '' });
const changing = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const pwValid = computed(() => !!policy.data.value && !!pw.current && validatePassword(pw.next, policy.data.value).length === 0 && pw.next === pw.confirm);

async function changePassword() {
  reset();
  changing.value = true;
  try {
    await authApi.changePassword(pw.current, pw.next);
    Object.assign(pw, { current: '', next: '', confirm: '' });
    feedback.success('Password changed', 'Other sessions were signed out.');
    await Promise.all([auth.loadContext(), sessions.run()]);
  } catch (e) {
    handle(e, 'Could not change password');
  } finally {
    changing.value = false;
  }
}

async function revoke(id: string) {
  try {
    await authApi.revokeSession(id);
    feedback.success('Session signed out');
    await sessions.run();
  } catch (e) {
    feedback.error('Could not revoke session', e);
  }
}

async function revokeOthers() {
  const ok = await feedback.confirm({ title: 'Sign out other sessions?', message: 'All devices except this one will be signed out immediately.', confirmLabel: 'Sign out others', danger: true });
  if (!ok) return;
  try {
    const { revoked } = await authApi.revokeOtherSessions();
    feedback.success(`${revoked} session(s) signed out`);
    await sessions.run();
  } catch (e) {
    feedback.error('Could not revoke sessions', e);
  }
}

const historyColumns: TableColumn<LoginEventRow>[] = [
  { key: 'createdAt', label: 'When' },
  { key: 'outcome', label: 'Result' },
  { key: 'device', label: 'Device' },
  { key: 'ipAddress', label: 'IP address' },
  { key: 'organization', label: 'Organization' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Security" description="Manage your password, two-factor authentication and signed-in devices." />

    <AppAlert v-if="auth.context?.passwordExpired">Your password has expired. Choose a new one to continue.</AppAlert>
    <AppAlert v-else-if="auth.context?.mfaSetupRequired">Your organization requires two-factor authentication. Set it up below to continue.</AppAlert>

    <div class="grid gap-4 lg:grid-cols-2">
      <AppCard title="Change password" description="Changing your password signs out your other sessions.">
        <AppSkeleton v-if="policy.loading.value" :lines="4" />
        <AppErrorState v-else-if="policy.error.value" :error="policy.error.value" @retry="policy.run" />
        <form v-else-if="policy.data.value" class="space-y-4" novalidate @submit.prevent="changePassword">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppInput v-model="pw.current" label="Current password" type="password" autocomplete="current-password" :error="fieldErrors.currentPassword" />
          <AppInput v-model="pw.next" label="New password" type="password" autocomplete="new-password" :error="fieldErrors.newPassword ?? fieldErrors.password" />
          <AppPasswordChecklist :password="pw.next" :policy="policy.data.value" />
          <AppInput v-model="pw.confirm" label="Confirm new password" type="password" autocomplete="new-password" :error="pw.confirm && pw.confirm !== pw.next ? 'Passwords do not match' : undefined" />
          <div class="flex justify-end"><AppButton type="submit" :icon="KeyRound" :loading="changing" :disabled="!pwValid">Change password</AppButton></div>
        </form>
      </AppCard>

      <AppCard title="Two-factor authentication" description="Require a code from your phone in addition to your password.">
        <MfaPanel />
      </AppCard>
    </div>

    <AppCard title="Active sessions" description="Devices currently signed in to your account." :padded="false">
      <template #actions>
        <AppButton variant="secondary" size="sm" :icon="LogOut" :disabled="(sessions.data.value?.length ?? 0) < 2" @click="revokeOthers">Sign out other sessions</AppButton>
      </template>
      <div v-if="sessions.loading.value && !sessions.data.value" class="p-4"><AppSkeleton :lines="3" /></div>
      <AppErrorState v-else-if="sessions.error.value" :error="sessions.error.value" @retry="sessions.run" />
      <ul v-else class="divide-y divide-line/70">
        <li v-for="s in sessions.data.value" :key="s.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div class="flex items-center gap-3">
            <span
              :class="[
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
                s.current ? 'bg-success-soft text-success-fg ring-success/15' : 'bg-surface-muted text-fg-muted ring-line',
              ]"
            >
              <Laptop :size="16" aria-hidden="true" />
            </span>
            <div>
              <p class="text-sm font-medium text-fg">
                {{ describeUserAgent(s.userAgent) }}
                <AppBadge v-if="s.current" tone="success" class="ms-1">This device</AppBadge>
                <AppBadge v-if="s.mfaVerified" tone="brand" class="ms-1">2FA</AppBadge>
              </p>
              <p class="text-xs text-fg-muted">{{ s.ipAddress ?? 'Unknown IP' }} · {{ s.organization?.name ?? 'Platform' }} · active {{ timeAgo(s.lastActiveAt) }}</p>
            </div>
          </div>
          <AppButton v-if="!s.current" variant="ghost" size="sm" @click="revoke(s.id)">Sign out</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppCard title="Sign-in history" :padded="false">
      <AppDataTable
        :columns="historyColumns"
        :rows="history.rows.value"
        :loading="history.loading.value"
        :error="history.error.value"
        :meta="history.meta.value"
        empty-title="No sign-in activity"
        caption="Sign-in history"
        @page="history.setPage"
        @retry="history.load"
        :filtered="history.isFiltered.value"
        @clear="history.clearFilters()">
        <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        <template #cell-outcome="{ row }">
          <AppBadge :tone="loginTone[row.outcome]">{{ statusLabel(row.outcome) }}</AppBadge>
          <span v-if="row.failureReason" class="ms-1 text-xs text-fg-subtle">{{ row.failureReason.replace(/_/g, ' ') }}</span>
        </template>
        <template #cell-device="{ row }">{{ describeUserAgent(row.userAgent) }}</template>
        <template #cell-organization="{ row }">{{ row.organization?.name ?? '—' }}</template>
        <template #card="{ row }"><LoginEventCard :event="row" own /></template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
