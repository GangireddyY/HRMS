<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ListChecks, Rocket, UserPlus } from '@lucide/vue';
import type { OnboardingCaseStatus } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import StartOnboardingModal from '@/modules/onboarding/components/StartOnboardingModal.vue';
import type { CaseDetail, CaseSummary, JoinerRef } from '@/modules/onboarding/types';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppTabs, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('onboarding.manage'));
const status = ref<OnboardingCaseStatus>('IN_PROGRESS');
const tabs = [
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];
const table = useTable((q) => onboardingApi.cases({ ...q, status: status.value }));
watch(status, () => void table.load());
const joiners = useAsync(() => (canManage.value ? onboardingApi.joiners() : Promise.resolve([])));
const templates = useAsync(() => onboardingApi.templates());

const startFor = ref<JoinerRef | null>(null);
async function onStarted(detail: CaseDetail) {
  startFor.value = null;
  feedback.success('Onboarding started', `${detail.employee.name} and their manager have been notified.`);
  await router.push(`/hr/onboarding/${detail.id}`);
}

const columns: TableColumn<CaseSummary>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'joiningDate', label: 'Joining date' },
  { key: 'progress', label: 'Progress' },
  { key: 'attention', label: '' },
];
const pct = (c: CaseSummary) => (c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0);
</script>

<template>
  <div>
    <AppPageHeader title="Onboarding" description="Joining checklists for new employees: documents, accounts, introductions and first-month check-ins.">
      <template #actions>
        <AppButton variant="secondary" :icon="ListChecks" to="/hr/onboarding/checklists">Checklists</AppButton>
      </template>
    </AppPageHeader>

    <AppCard v-if="canManage && joiners.data.value?.length" class="mb-4" title="New joiners without onboarding" :icon="UserPlus" :description="`${joiners.data.value.length} recent or upcoming joiner${joiners.data.value.length === 1 ? '' : 's'}.`">
      <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="j in joiners.data.value" :key="j.id" class="flex items-center gap-3 rounded-xl p-3 ring-1 ring-line">
          <AppAvatar :name="j.name" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ j.name }}</p>
            <p class="truncate text-xs text-fg-muted">{{ [j.designation?.name, `joins ${formatDate(j.dateOfJoining)}`].filter(Boolean).join(' · ') }}</p>
          </div>
          <AppButton size="sm" :icon="Rocket" :disabled="!templates.data.value" @click="startFor = j">Start</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppTabs v-model="status" :tabs="tabs">
      <AppCard :padded="false">
        <div class="border-b border-line p-4">
          <AppSearchInput v-model="table.search.value" placeholder="Search name or code" aria-label="Search onboarding" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Onboarding cases"
          :empty-title="status === 'IN_PROGRESS' ? 'No onboarding in progress' : 'Nothing here yet'"
          :empty-description="status === 'IN_PROGRESS' && canManage ? 'New joiners without onboarding are listed above with a Start button.' : undefined"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(row) => router.push(`/hr/onboarding/${row.id}`)"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ [row.employee.designation?.name, row.employee.department?.name].filter(Boolean).join(' · ') || row.employee.employeeCode }}</p>
              </div>
            </div>
          </template>
          <template #cell-joiningDate="{ row }">{{ formatDate(row.joiningDate) }}</template>
          <template #cell-progress="{ row }">
            <div class="flex min-w-40 items-center gap-3">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${pct(row)}%` }" />
              </div>
              <span class="text-xs text-fg-muted tabular-nums">{{ row.progress.done }}/{{ row.progress.total }}</span>
            </div>
          </template>
          <template #cell-attention="{ row }">
            <div class="flex flex-wrap justify-end gap-1.5">
              <AppBadge v-if="row.progress.overdue && row.status === 'IN_PROGRESS'" tone="danger" size="sm">{{ row.progress.overdue }} overdue</AppBadge>
              <AppBadge v-if="row.progress.awaitingVerification" tone="warning" size="sm">{{ row.progress.awaitingVerification }} to verify</AppBadge>
              <AppBadge v-if="row.status === 'IN_PROGRESS' && !row.progress.requiredOpen" tone="success" size="sm">Ready to complete</AppBadge>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <StartOnboardingModal :open="!!startFor" :employee="startFor" :templates="templates.data.value ?? []" @close="startFor = null" @started="onStarted" />
  </div>
</template>
