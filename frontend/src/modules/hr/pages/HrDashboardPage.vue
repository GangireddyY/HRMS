<script setup lang="ts">
import { computed } from 'vue';
import { MailPlus, Users } from '@lucide/vue';
import { MODULES, PERMISSIONS, SCOPE_RANK, type PermissionScope } from '@contracts';
import { reportsApi } from '@/modules/reports/api/reports.api';
import { usersApi } from '@/modules/users/api/users.api';
import { AppBadge, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { formatDate } from '@/shared/utils/format';
import { SCOPE_LABELS, scopeTone } from '@/shared/utils/status';

const auth = useAuthStore();
const canSeeUsers = computed(() => auth.can('user.view'));
const canSeeHeadcount = computed(() => auth.can('reports.view', 'TEAM') && auth.hasFeature('reports'));
const headcount = useAsync(() => reportsApi.run('headcount', {}), { immediate: canSeeHeadcount.value });
const thisMonth = computed(() => headcount.data.value?.trend?.at(-1) ?? null);
const active = useAsync(() => usersApi.list({ status: 'ACTIVE', pageSize: 1 }), { immediate: canSeeUsers.value });
const invited = useAsync(() => usersApi.list({ status: 'INVITED', pageSize: 5, sort: 'createdAt:desc' }), { immediate: canSeeUsers.value });

/** Entitled business modules with the user's broadest scope and granted actions. */
const moduleAccess = computed(() =>
  MODULES.filter((m) => !m.core && auth.hasFeature(m.key))
    .map((m) => {
      const granted = PERMISSIONS.filter((p) => p.module === m.key && auth.context?.permissions[p.key]);
      const broadest = granted.reduce<PermissionScope | null>((acc, p) => {
        const s = auth.context!.permissions[p.key]!;
        return !acc || SCOPE_RANK[s] > SCOPE_RANK[acc] ? s : acc;
      }, null);
      return { ...m, granted, broadest };
    })
    .filter((m) => m.granted.length > 0),
);
</script>

<template>
  <div class="space-y-6">
    <AppPageHeader title="HR operations" :description="`People operations for ${auth.organization?.name}.`" />

    <section v-if="canSeeHeadcount" aria-labelledby="at-a-glance">
      <div class="mb-3 flex items-center justify-between">
        <h2 id="at-a-glance" class="text-sm font-medium text-fg">At a glance</h2>
        <RouterLink to="/hr/reports" class="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">All reports</RouterLink>
      </div>
      <AppErrorState v-if="headcount.error.value" :error="headcount.error.value" @retry="headcount.run" />
      <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AppStatCard label="Headcount" :value="headcount.data.value?.summary.headcount" :loading="headcount.loading.value" :icon="Users" to="/hr/reports/headcount" />
        <AppStatCard label="Serving notice" :value="headcount.data.value?.summary.onNotice" :loading="headcount.loading.value" tone="warning" />
        <AppStatCard label="Joined this month" :value="thisMonth?.joiners" :loading="headcount.loading.value" tone="success" />
        <AppStatCard label="Left this month" :value="thisMonth?.leavers" :loading="headcount.loading.value" tone="danger" to="/hr/reports/attrition" />
      </div>
    </section>

    <div v-if="canSeeUsers" class="grid gap-4 sm:grid-cols-2">
      <AppStatCard label="Active users" :value="active.data.value?.meta.total" :loading="active.loading.value" :icon="Users" />
      <AppStatCard label="Pending invitations" :value="invited.data.value?.meta.total" :loading="invited.loading.value" :icon="MailPlus" tone="warning" />
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <AppCard class="lg:col-span-2" title="Your HR access" description="Modules in your subscription and the record scope your roles grant.">
        <AppEmptyState v-if="!moduleAccess.length" title="No module access" description="Your roles do not grant HR module permissions yet." />
        <ul v-else class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          <li v-for="m in moduleAccess" :key="m.key" class="rounded-lg border border-line p-3.5">
            <div class="flex items-start justify-between gap-2">
              <p class="text-sm font-medium text-fg">{{ m.name }}</p>
              <AppBadge v-if="m.broadest" :tone="scopeTone[m.broadest]">{{ SCOPE_LABELS[m.broadest] }}</AppBadge>
            </div>
            <p class="mt-1 text-xs text-fg-muted">{{ m.granted.length }} permission{{ m.granted.length === 1 ? '' : 's' }} · {{ m.description }}</p>
          </li>
        </ul>
      </AppCard>

      <AppCard v-if="canSeeUsers" title="Pending invitations">
        <AppSkeleton v-if="invited.loading.value" :lines="4" />
        <AppErrorState v-else-if="invited.error.value" :error="invited.error.value" @retry="invited.run" />
        <AppEmptyState v-else-if="!invited.data.value?.items.length" title="No pending invitations" />
        <ul v-else class="divide-y divide-line">
          <li v-for="m in invited.data.value.items" :key="m.id" class="py-2.5">
            <RouterLink :to="`/admin/users/${m.id}`" class="block hover:underline">
              <p class="text-sm font-medium text-fg">{{ m.firstName }} {{ m.lastName }}</p>
              <p class="text-xs text-fg-muted">{{ m.email }} · invited {{ formatDate(m.invitedAt) }}</p>
            </RouterLink>
          </li>
        </ul>
      </AppCard>
    </div>
  </div>
</template>
