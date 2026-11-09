<script setup lang="ts">
import { computed } from 'vue';
import { CalendarDays, FileText, HandHeart, MapPin, Scale, UserRound, Users } from '@lucide/vue';
import type { CaseDetail } from '@/modules/grievance/types';
import { CATEGORY_LABELS } from '@/modules/grievance/utils/grievance-format';
import { CATEGORY_VISUALS } from '@/modules/grievance/utils/case-sla';
import { AppAlert, AppAvatar } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** What the complaint says, for the people handling it: the account, who it is about, the incident and (POSH) the filing details. */
const props = defineProps<{ grievance: CaseDetail }>();
const about = computed(() => [props.grievance.respondent?.name, props.grievance.respondentName].filter(Boolean).join(' · ') || null);
const when = computed(() => (props.grievance.incidentDate ? formatDate(props.grievance.incidentDate) : null));
const filing = { ON_TIME: null, LATE: 'Made more than 3 months after the incident. The committee may extend the time limit by up to 3 months, recording its reasons (section 9).', BEYOND_EXTENSION: 'Made more than 6 months after the incident — beyond the time limit and its extension (section 9).' } as const;
</script>

<template>
  <section class="card overflow-hidden" aria-labelledby="complaint-title">
    <header class="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/70 px-4 py-2">
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><FileText :size="16" /></span>
      <div class="min-w-0 flex-1 basis-48">
        <h2 id="complaint-title" class="text-sm font-semibold text-fg">Complaint</h2>
        <p class="text-xs text-fg-muted">In the complainant's words, submitted {{ formatDate(grievance.submittedOn) }}</p>
      </div>
      <span :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', CATEGORY_VISUALS[grievance.category].tile]">
        <component :is="CATEGORY_VISUALS[grievance.category].icon" :size="12" aria-hidden="true" />{{ CATEGORY_LABELS[grievance.category] }}
      </span>
    </header>

    <div class="p-4">
      <h3 class="mb-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">What happened</h3>
      <p class="max-w-3xl text-sm leading-relaxed whitespace-pre-line text-fg">{{ grievance.description }}</p>

      <dl class="mt-5 grid gap-px overflow-hidden rounded-md bg-line/70 ring-1 ring-line/70 sm:grid-cols-3">
        <div class="flex items-start gap-2.5 bg-surface px-3 py-2.5">
          <UserRound :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <div class="min-w-0">
            <dt class="text-xs text-fg-muted">About</dt>
            <dd class="flex min-w-0 items-center gap-1.5 text-sm text-fg">
              <AppAvatar v-if="grievance.respondent" :name="grievance.respondent.name" size="xs" />
              <span class="min-w-0">
                <span class="block truncate">{{ about ?? 'Not named' }}</span>
                <span v-if="grievance.respondent?.designation" class="block truncate text-xs text-fg-muted">{{ grievance.respondent.designation }}</span>
              </span>
            </dd>
          </div>
        </div>
        <div class="flex items-start gap-2.5 bg-surface px-3 py-2.5">
          <CalendarDays :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <div class="min-w-0">
            <dt class="text-xs text-fg-muted">When</dt>
            <dd class="text-sm text-fg">{{ when ?? '—' }}</dd>
          </div>
        </div>
        <div class="flex items-start gap-2.5 bg-surface px-3 py-2.5">
          <MapPin :size="15" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <div class="min-w-0">
            <dt class="text-xs text-fg-muted">Where</dt>
            <dd class="text-sm break-words text-fg">{{ grievance.incidentLocation ?? '—' }}</dd>
          </div>
        </div>
      </dl>

      <div v-if="grievance.witnesses" class="mt-4">
        <h3 class="mb-1 flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase"><Users :size="12" aria-hidden="true" />Witnesses</h3>
        <p class="text-sm whitespace-pre-line text-fg">{{ grievance.witnesses }}</p>
      </div>

      <div v-if="grievance.poshDetails" class="mt-4 space-y-3 rounded-md bg-special-soft/40 p-4 text-sm ring-1 ring-special/15 ring-inset">
        <p class="flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-special-fg uppercase"><Scale :size="12" aria-hidden="true" />POSH filing details</p>
        <AppAlert v-if="grievance.role === 'HANDLER' && filing[grievance.poshDetails.filing]" tone="warning">{{ filing[grievance.poshDetails.filing] }}</AppAlert>
        <div v-if="grievance.poshDetails.delayReason">
          <p class="text-xs text-fg-muted">Reason for the delay</p>
          <p class="whitespace-pre-line text-fg">{{ grievance.poshDetails.delayReason }}</p>
        </div>
        <div>
          <p class="flex items-center gap-1 text-xs text-fg-muted"><HandHeart :size="12" aria-hidden="true" />Support requested during the inquiry</p>
          <p class="whitespace-pre-line text-fg">{{ grievance.poshDetails.interimRelief ?? 'None' }}</p>
        </div>
        <p class="text-fg">{{ grievance.poshDetails.conciliationRequested ? 'Conciliation requested before an inquiry (section 10).' : 'No conciliation requested.' }}</p>
      </div>
    </div>
  </section>
</template>
