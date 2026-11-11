<script setup lang="ts">
import type { ApprovalChainProgress } from '@contracts';
import { formatDateTime } from '@/shared/utils/format';

/** Steps of a configured approval chain: who has decided, who decides now (and by when), who comes next. */
const props = defineProps<{ progress: ApprovalChainProgress }>();

const decisionAt = (step: number) => props.progress.decisions.find((d) => d.step === step) ?? null;
const DOT: Record<ApprovalChainProgress['steps'][number]['state'], string> = {
  done: 'bg-success text-white',
  current: 'bg-brand text-white ring-4 ring-brand/20',
  rejected: 'bg-danger text-white',
  upcoming: 'bg-surface-muted text-fg-muted',
};
</script>

<template>
  <section class="text-sm" :aria-label="`Approval chain: ${progress.chain}`">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <p class="font-medium text-fg">{{ progress.chain }}</p>
      <p v-if="progress.status === 'PENDING' && progress.dueAt" class="text-xs" :class="progress.escalated ? 'text-danger' : 'text-fg-muted'">
        {{ progress.escalated ? 'Overdue, escalated' : `Due ${formatDateTime(progress.dueAt)}` }}
      </p>
      <p v-else-if="progress.status === 'CANCELLED'" class="text-xs text-fg-muted">Cancelled</p>
    </div>
    <ol class="space-y-3">
      <li v-for="(s, i) in progress.steps" :key="i" class="flex gap-3">
        <span :class="['mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', DOT[s.state]]" aria-hidden="true">{{ i + 1 }}</span>
        <div class="min-w-0">
          <p class="text-fg">
            {{ s.label }}
            <span class="sr-only">: {{ s.state === 'current' ? 'deciding now' : s.state }}</span>
            <span v-if="s.state === 'current'" class="ms-1 text-xs text-brand">deciding now</span>
          </p>
          <p v-if="decisionAt(i)" class="text-xs text-fg-muted">
            {{ decisionAt(i)!.decision === 'APPROVED' ? 'Approved' : 'Rejected' }} by {{ decisionAt(i)!.name }}{{ decisionAt(i)!.onBehalf ? ' (covering)' : '' }} ·
            {{ formatDateTime(decisionAt(i)!.at) }}
          </p>
          <p v-if="decisionAt(i)?.note" class="mt-0.5 text-xs text-fg-subtle">“{{ decisionAt(i)!.note }}”</p>
        </div>
      </li>
    </ol>
  </section>
</template>
