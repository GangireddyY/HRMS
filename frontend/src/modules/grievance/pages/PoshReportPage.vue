<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Printer } from '@lucide/vue';
import { GRIEVANCE_OUTCOMES } from '@contracts';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import { OUTCOME_LABELS } from '@/modules/grievance/utils/grievance-format';
import { AppButton, AppCard, AppErrorState, AppPageHeader, AppSelect, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** Figures for the Internal Committee's annual report (section 21 and rule 14 of the POSH Act). */
const thisYear = new Date().getFullYear();
const year = ref(thisYear);
const yearOptions = Array.from({ length: 6 }, (_, i) => ({ value: thisYear - i, label: String(thisYear - i) }));
const report = useAsync(() => grievanceApi.poshReport(year.value));
watch(year, () => void report.run());
const r = computed(() => report.data.value);
const print = () => window.print();
</script>

<template>
  <div>
    <AppPageHeader title="POSH annual report" description="Figures for the Internal Committee's annual report to the employer and the District Officer (section 21)." back="/hr/grievances" back-label="Grievances">
      <template #actions>
        <AppSelect v-model="year" :options="yearOptions" :clearable="false" aria-label="Calendar year" class="w-32" />
        <AppButton variant="secondary" :icon="Printer" @click="print">Print</AppButton>
      </template>
    </AppPageHeader>
    <AppSkeleton v-if="report.loading.value && !r" :lines="6" />
    <AppErrorState v-else-if="report.error.value" :error="report.error.value" @retry="report.run" />
    <template v-else-if="r">
      <p class="mb-4 text-sm text-fg-muted">Calendar year {{ r.year }}, as of {{ formatDate(r.asOf) }}.</p>
      <div class="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AppStatCard label="Complaints received" :value="r.received" />
        <AppStatCard label="Disposed of" :value="r.disposed" tone="success" />
        <AppStatCard label="Pending" :value="r.pending" tone="info" />
        <AppStatCard label="Pending over 90 days" :value="r.pendingOver90Days" tone="danger" />
      </div>
      <AppCard title="Outcomes of complaints disposed of" :description="r.withdrawn ? `${r.withdrawn} complaint${r.withdrawn === 1 ? ' was' : 's were'} withdrawn.` : undefined">
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div v-for="o in GRIEVANCE_OUTCOMES" :key="o" class="flex justify-between gap-4 border-b border-line/70 pb-2">
            <dt class="text-fg-muted">{{ OUTCOME_LABELS[o] }}</dt>
            <dd class="font-medium text-fg tabular-nums">{{ r.outcomes[o] ?? 0 }}</dd>
          </div>
        </dl>
        <p class="mt-4 text-xs text-fg-muted">Add the number of awareness workshops held and the nature of the action taken by the employer when filing the report.</p>
      </AppCard>
    </template>
  </div>
</template>
