<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FilterX, LayoutGrid, Rows3, SearchX, UserPlus, Users } from '@lucide/vue';
import type { MembershipStatus } from '@contracts';
import { rolesApi } from '@/modules/roles/api/roles.api';
import { usersApi } from '@/modules/users/api/users.api';
import type { Member } from '@/modules/users/types';
import InviteUserModal from '@/modules/users/components/InviteUserModal.vue';
import UserProfileCard from '@/modules/users/components/UserProfileCard.vue';
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppEmptyState,
  AppErrorState,
  AppPageHeader,
  AppPagination,
  AppSearchInput,
  AppSegmented,
  AppSelect,
  type TableColumn,
} from '@/shared/components';
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

const VIEW_KEY = 'hrms.users.view';
const view = ref<'table' | 'grid'>(localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table');
watch(view, (v) => localStorage.setItem(VIEW_KEY, v));
const viewOptions = [
  { value: 'table' as const, label: 'Table', icon: Rows3 },
  { value: 'grid' as const, label: 'Grid', icon: LayoutGrid },
];
/** The grid has no column headers to click, so it offers the same orderings as a list. */
const sortOptions = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'lastLoginAt:desc', label: 'Recently signed in' },
  { value: 'status:asc', label: 'Status' },
];

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
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_220px_auto]">
        <AppSearchInput v-model="table.search.value" class="sm:col-span-2 lg:col-span-1" placeholder="Search name or email" aria-label="Search users" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        <AppSelect v-model="table.filters.roleId" :options="roleOptions" placeholder="All roles" aria-label="Filter by role" />
        <AppSegmented v-model="view" class="sm:col-span-2 lg:col-span-1 lg:w-48" :options="viewOptions" label="Layout" />
      </div>

      <div v-if="view === 'grid'" :aria-busy="table.loading.value || undefined">
        <AppErrorState v-if="table.error.value && !table.loading.value" :error="table.error.value" @retry="table.load" />
        <template v-else>
          <div v-if="table.rows.value.length > 1" class="flex items-center justify-end gap-2 px-4 pt-3 text-xs text-fg-muted">
            <span class="font-medium" aria-hidden="true">Sort by</span>
            <AppSelect
              :model-value="sortOptions.some((o) => o.value === table.sort.value) ? table.sort.value : undefined"
              :options="sortOptions"
              placeholder="Default order"
              :clearable="false"
              :searchable="false"
              aria-label="Sort by"
              size="sm"
              class="w-48"
              @update:model-value="(v) => v && (table.sort.value = v)"
            />
          </div>
          <ul v-if="table.loading.value && !table.rows.value.length" class="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-label="Loading users">
            <li v-for="i in 8" :key="i" class="card overflow-hidden">
              <div class="skeleton h-16 rounded-none" />
              <div class="flex flex-col items-center gap-2 px-4 pb-5">
                <div class="relative z-10 -mt-10 h-22 w-22 rounded-full bg-surface p-1"><div class="skeleton h-full w-full rounded-full" /></div>
                <div class="skeleton h-3.5 w-2/3 rounded-full" />
                <div class="skeleton h-3 w-1/2 rounded-full" />
                <div class="skeleton mt-4 h-8 w-full rounded-full" />
              </div>
            </li>
          </ul>
          <ul v-else-if="table.rows.value.length" :class="['grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', table.loading.value && 'opacity-60']">
            <li v-for="m in table.rows.value" :key="m.id"><UserProfileCard :member="m" /></li>
          </ul>
          <AppEmptyState v-else-if="table.isFiltered.value" :icon="SearchX" title="No matches" description="Nothing matches your search or filters.">
            <AppButton variant="secondary" size="sm" :icon="FilterX" @click="table.clearFilters()">Clear filters</AppButton>
          </AppEmptyState>
          <AppEmptyState v-else :icon="Users" title="No users found" description="Try a different search or filter.">
            <AppButton v-if="auth.can('user.invite')" :icon="UserPlus" :disabled="!roles.data.value" @click="inviteOpen = true">Invite user</AppButton>
          </AppEmptyState>
          <AppPagination
            v-if="table.meta.value && table.meta.value.total > 0"
            class="border-t border-line"
            :meta="table.meta.value"
            :disabled="table.loading.value"
            @change="table.setPage"
          />
        </template>
      </div>

      <AppDataTable
        v-else
        v-model:sort="table.sort.value"
        :grid="false"
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
