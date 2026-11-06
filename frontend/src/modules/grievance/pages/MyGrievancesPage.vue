<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight, LifeBuoy, Plus, ShieldCheck } from '@lucide/vue';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import GrievanceFormModal from '@/modules/grievance/components/GrievanceFormModal.vue';
import type { CaseDetail } from '@/modules/grievance/types';
import { CATEGORY_LABELS, OUTCOME_LABELS, STATUS_LABELS, statusTone } from '@/modules/grievance/utils/grievance-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPagination, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => grievanceApi.mine(q), { pageSize: 10 });
const formOpen = ref(false);
async function onSaved(c: CaseDetail, failed: string[]) {
  formOpen.value = false;
  feedback.success(`${c.reference} submitted`, c.posh ? 'The Internal Committee has been notified.' : 'The people handling grievances have been notified.');
  if (failed.length) feedback.error('Some files were not added', `${failed.join(', ')} — add them from the case page.`);
  await router.push(`/me/grievances/${c.id}`);
}
</script>

<template>
  <div>
    <AppPageHeader title="Grievances" description="Raise a concern confidentially and follow it to a resolution.">
      <template #actions><AppButton :icon="Plus" @click="formOpen = true">Raise a grievance</AppButton></template>
    </AppPageHeader>
    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <AppSkeleton v-if="table.loading.value && !table.rows.value.length" :lines="5" />
        <AppErrorState v-else-if="table.error.value" :error="table.error.value" @retry="table.load" />
        <AppCard v-else-if="!table.rows.value.length">
          <AppEmptyState :icon="LifeBuoy" title="No grievances" description="If something at work isn't right, you can raise it here." />
        </AppCard>
        <AppCard v-else :padded="false">
          <ul class="divide-y divide-line">
            <li v-for="c in table.rows.value" :key="c.id">
              <RouterLink :to="`/me/grievances/${c.id}`" class="flex items-center gap-4 px-5 py-4 transition hover:bg-surface-muted/50">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-fg">{{ c.subject }}</p>
                  <p class="text-xs text-fg-muted">
                    {{ c.reference }} · {{ CATEGORY_LABELS[c.category] }} · submitted {{ formatDate(c.submittedOn) }}
                    <template v-if="c.outcome"> · {{ OUTCOME_LABELS[c.outcome] }}</template>
                  </p>
                </div>
                <AppBadge :tone="statusTone[c.status]" dot>{{ STATUS_LABELS[c.status] }}</AppBadge>
                <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
          <div v-if="table.meta.value && table.meta.value.totalPages > 1" class="border-t border-line p-3">
            <AppPagination :meta="table.meta.value" @page="table.setPage" />
          </div>
        </AppCard>
      </div>
      <AppCard title="How it works" :icon="ShieldCheck">
        <ul class="space-y-2 text-sm text-fg-muted">
          <li>Only the people handling your case can read it. The person you complain about can't see it.</li>
          <li>Grievances get a response within 30 days. You can message the handler and add evidence at any time.</li>
          <li>Sexual harassment complaints go only to the Internal Committee under the POSH Act, and the inquiry finishes within 90 days.</li>
          <li>Retaliation for raising a concern in good faith is not allowed.</li>
        </ul>
      </AppCard>
    </div>
    <GrievanceFormModal :open="formOpen" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
