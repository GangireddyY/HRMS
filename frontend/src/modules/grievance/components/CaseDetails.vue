<script setup lang="ts">
import { computed } from 'vue';
import type { CaseDetail } from '@/modules/grievance/types';
import { CATEGORY_LABELS } from '@/modules/grievance/utils/grievance-format';
import { AppAlert, AppCard } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** What the complaint says: description, the people and the incident. */
const props = defineProps<{ grievance: CaseDetail }>();
const about = computed(() => [props.grievance.respondent?.name, props.grievance.respondentName].filter(Boolean).join(' · ') || null);
const filing = { ON_TIME: null, LATE: 'Made more than 3 months after the incident. The committee may extend the time limit by up to 3 months, recording its reasons (section 9).', BEYOND_EXTENSION: 'Made more than 6 months after the incident — beyond the time limit and its extension (section 9).' } as const;
</script>

<template>
  <AppCard title="Complaint">
    <dl class="mb-4 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
      <div>
        <dt class="text-fg-muted">Category</dt>
        <dd class="text-fg">{{ CATEGORY_LABELS[grievance.category] }}</dd>
      </div>
      <div v-if="grievance.role === 'HANDLER'">
        <dt class="text-fg-muted">Raised by</dt>
        <dd class="text-fg">{{ grievance.complainant?.name }}<span v-if="grievance.complainant?.department" class="text-fg-muted"> · {{ grievance.complainant.department }}</span></dd>
      </div>
      <div>
        <dt class="text-fg-muted">About</dt>
        <dd class="text-fg">{{ about ?? 'Not named' }}<span v-if="grievance.respondent?.designation" class="text-fg-muted"> · {{ grievance.respondent.designation }}</span></dd>
      </div>
      <div>
        <dt class="text-fg-muted">When &amp; where</dt>
        <dd class="text-fg">{{ [grievance.incidentDate ? formatDate(grievance.incidentDate) : null, grievance.incidentLocation].filter(Boolean).join(' · ') || '—' }}</dd>
      </div>
      <div>
        <dt class="text-fg-muted">Submitted</dt>
        <dd class="text-fg">{{ formatDate(grievance.submittedOn) }}</dd>
      </div>
      <div>
        <dt class="text-fg-muted">{{ grievance.posh ? 'Inquiry due by' : 'Response due by' }}</dt>
        <dd :class="grievance.overdue ? 'font-medium text-danger-fg' : 'text-fg'">{{ formatDate(grievance.dueOn) }}{{ grievance.overdue ? ' · overdue' : '' }}</dd>
      </div>
    </dl>
    <h3 class="mb-1 text-sm font-medium text-fg">What happened</h3>
    <p class="text-sm whitespace-pre-line text-fg">{{ grievance.description }}</p>
    <template v-if="grievance.witnesses">
      <h3 class="mt-4 mb-1 text-sm font-medium text-fg">Witnesses</h3>
      <p class="text-sm whitespace-pre-line text-fg">{{ grievance.witnesses }}</p>
    </template>
    <div v-if="grievance.poshDetails" class="mt-4 space-y-3 rounded-xl p-4 text-sm ring-1 ring-line">
      <AppAlert v-if="grievance.role === 'HANDLER' && filing[grievance.poshDetails.filing]" tone="warning">{{ filing[grievance.poshDetails.filing] }}</AppAlert>
      <div v-if="grievance.poshDetails.delayReason">
        <p class="text-fg-muted">Reason for the delay</p>
        <p class="whitespace-pre-line text-fg">{{ grievance.poshDetails.delayReason }}</p>
      </div>
      <div>
        <p class="text-fg-muted">Support requested during the inquiry</p>
        <p class="whitespace-pre-line text-fg">{{ grievance.poshDetails.interimRelief ?? 'None' }}</p>
      </div>
      <p class="text-fg">{{ grievance.poshDetails.conciliationRequested ? 'Conciliation requested before an inquiry (section 10).' : 'No conciliation requested.' }}</p>
    </div>
  </AppCard>
</template>
