<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { UserPlus } from '@lucide/vue';
import type { MembershipStatus } from '@contracts';
import { rolesApi } from '@/modules/roles/api/roles.api';
import { usersApi } from '@/modules/users/api/users.api';
import type { Member } from '@/modules/users/types';
import InviteUserModal from '@/modules/users/components/InviteUserModal.vue';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';
import { membershipTone, statusLabel } from '@/shared/utils/status';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const roles = useAsync(() => rolesApi.list());
const table = useTable((q) => usersApi.list(q), {
  sort: 'createdAt:desc',
  filters: { status: undefined as MembershipStatus | undefined, roleId: undefined as string | undefined },
});
const inviteOpen = ref(route.query.invite === '1' && auth.can('user.invite'));

const columns: TableColumn<Member>[] = [
  { key: 'name', label: 'User', sortField: 'name' },
  { key: 'roles', label: 'Roles' },
  { key: 'status', label: 'Status', sortField: 'status' },
  { key: 'mfa', label: '2FA' },
  { key: 'lastLoginAt', label: 'Last sign-in', sortField: 'lastLoginAt' },
];

const statusOptions = [
  { label: 'Active', value: 'ACTIVE' as MembershipStatus },
  { label: 'Invited', value: 'INVITED' as MembershipStatus },
  { label: 'Suspended', value: 'SUSPENDED' as MembershipStatus },
];
const roleOptions = computed(() => (roles.data.value ?? []).map((r) => ({ label: r.name, value: r.id })));

function onInvited(member: Member) {
  inviteOpen.value = false;
  feedback.success('Invitation sent', `${member.email} will receive an email to join.`);
  void table.load();
}
</script>

<template>
  <div>
    <AppPageHeader title="Users" description="People with access to this organization, their roles and status.">
      <template #actions>
        <AppButton v-if="auth.can('user.invite')" :icon="UserPlus" :disabled="!roles.data.value" @click="inviteOpen = true">Invite user</AppButton>
      </template>
    </AppPageHeader>

    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_180px_220px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search name or email" aria-label="Search users" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        <AppSelect v-model="table.filters.roleId" :options="roleOptions" placeholder="All roles" aria-label="Filter by role" />
      </div>
      <AppDataTable
        v-model:sort="table.sort.value"
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Organization users"
        empty-title="No users found"
        empty-description="Try a different search or filter."
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/admin/users/${row.id}`)"
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
      >
        <template #empty><AppButton v-if="auth.can('user.invite')" :icon="UserPlus" :disabled="!roles.data.value" @click="inviteOpen = true">Invite user</AppButton></template>
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="`${row.firstName} ${row.lastName}`" :src="row.avatarUrl" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.firstName }} {{ row.lastName }}</p>
              <p class="truncate text-xs text-fg-muted">{{ row.email }}</p>
            </div>
          </div>
        </template>
        <template #cell-roles="{ row }">
          <div class="flex flex-wrap gap-1">
            <AppBadge v-for="r in row.roles.slice(0, 2)" :key="r.id" tone="brand">{{ r.name }}</AppBadge>
            <AppBadge v-if="row.roles.length > 2">+{{ row.roles.length - 2 }}</AppBadge>
          </div>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="membershipTone[row.status]" dot>{{ statusLabel(row.status) }}</AppBadge></template>
        <template #cell-mfa="{ row }"><AppBadge :tone="row.mfaEnabled ? 'success' : 'neutral'">{{ row.mfaEnabled ? 'On' : 'Off' }}</AppBadge></template>
        <template #cell-lastLoginAt="{ row }"><span class="text-fg-muted">{{ timeAgo(row.lastLoginAt) }}</span></template>
      </AppDataTable>
    </AppCard>

    <InviteUserModal :open="inviteOpen" :roles="roles.data.value ?? []" @close="inviteOpen = false" @invited="onInvited" />
  </div>
</template>
