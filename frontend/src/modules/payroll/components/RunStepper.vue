<script setup lang="ts">
import { computed, type Component } from 'vue';
import { BadgeCheck, Calculator, Check, FilePlus2, Send, Wallet } from '@lucide/vue';
import type { PayrollRun } from '@/modules/payroll/types';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Where a payroll run is in its workflow: started, calculated, submitted, approved (payslips published) and paid. */
const props = withDefaults(defineProps<{ run: PayrollRun; compact?: boolean }>(), { compact: false });

interface Step {
  key: string;
  label: string;
  icon: Component;
  at: string | null;
  by: string | null;
  waiting: string;
}
const steps = computed<Step[]>(() => {
  const r = props.run;
  const approved = r.status === 'APPROVED' || r.status === 'PAID';
  return [
    { key: 'draft', label: 'Started', icon: FilePlus2, at: r.createdAt, by: null, waiting: '' },
    { key: 'calculated', label: 'Calculated', icon: Calculator, at: r.calculatedAt, by: r.calculatedBy, waiting: 'Calculate the payslips' },
    { key: 'submitted', label: 'Submitted', icon: Send, at: r.status === 'DRAFT' ? null : r.submittedAt, by: r.submittedBy, waiting: r.reviewNote && r.status === 'DRAFT' ? 'Sent back · fix and resubmit' : 'Review, then submit' },
    { key: 'approved', label: 'Approved & published', icon: BadgeCheck, at: approved ? r.reviewedAt : null, by: approved ? r.reviewedBy : null, waiting: 'Waiting for an approver' },
    { key: 'paid', label: 'Paid', icon: Wallet, at: r.paidAt, by: r.paidBy, waiting: 'Transfer salaries, then mark paid' },
  ];
});
/** Index of the step in progress; past the end once paid. */
const current = computed(() => {
  const r = props.run;
  if (r.status === 'PAID') return 5;
  if (r.status === 'APPROVED') return 4;
  if (r.status === 'SUBMITTED') return 3;
  return r.calculatedAt ? 2 : 1;
});
const cancelled = computed(() => props.run.status === 'CANCELLED');
const sentBack = computed(() => props.run.status === 'DRAFT' && !!props.run.reviewNote);
const state = (i: number) => (cancelled.value ? 'off' : i < current.value ? 'done' : i === current.value ? 'now' : 'next');
</script>

<template>
  <!-- Compact: a five-segment bar for lists. -->
  <div v-if="compact" class="flex items-center gap-1" role="img" :aria-label="cancelled ? 'Cancelled' : `Step ${Math.min(current + 1, 5)} of 5: ${steps[Math.min(current, 4)]!.label}`">
    <span
      v-for="(s, i) in steps"
      :key="s.key"
      :class="[
        'h-1.5 w-4 rounded-full',
        state(i) === 'done' ? 'bg-success' : state(i) === 'now' ? (sentBack && i === 2 ? 'bg-warning' : 'bg-info') : 'bg-line',
      ]"
      :title="s.label"
    />
  </div>

  <ol v-else class="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-0" aria-label="Payroll progress">
    <li v-for="(s, i) in steps" :key="s.key" class="relative flex gap-3 sm:flex-col sm:items-center sm:gap-2 sm:px-2 sm:text-center" :aria-current="state(i) === 'now' ? 'step' : undefined">
      <span v-if="i < steps.length - 1" :class="['absolute top-4 hidden h-0.5 sm:start-[calc(50%+1.25rem)] sm:end-[calc(-50%+1.25rem)] sm:block', state(i) === 'done' ? 'bg-success' : 'bg-line']" aria-hidden="true" />
      <span
        :class="[
          'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface',
          state(i) === 'done' && 'bg-success text-white',
          state(i) === 'now' && (sentBack && i === 2 ? 'border-2 border-warning bg-warning-soft text-warning-fg' : 'border-2 border-brand-500 bg-accent-soft text-accent-fg'),
          (state(i) === 'next' || state(i) === 'off') && 'border border-line bg-surface-muted text-fg-subtle',
        ]"
        aria-hidden="true"
      >
        <Check v-if="state(i) === 'done'" :size="15" :stroke-width="3" />
        <component :is="s.icon" v-else :size="15" />
      </span>
      <div class="min-w-0">
        <p :class="['text-sm', state(i) === 'now' ? 'font-semibold text-fg' : state(i) === 'done' ? 'font-medium text-fg' : 'text-fg-muted']">
          {{ s.label }}<span class="sr-only">{{ state(i) === 'done' ? ' (done)' : state(i) === 'now' ? ' (in progress)' : '' }}</span>
        </p>
        <p v-if="state(i) === 'done' && s.at" class="truncate text-2xs text-fg-muted" :title="formatDateTime(s.at)">{{ s.by ? `${s.by} · ` : '' }}{{ timeAgo(s.at) }}</p>
        <p v-else-if="state(i) === 'now'" :class="['text-2xs font-medium', sentBack && i === 2 ? 'text-warning-fg' : 'text-accent-fg']">{{ s.waiting }}</p>
      </div>
    </li>
  </ol>
</template>
