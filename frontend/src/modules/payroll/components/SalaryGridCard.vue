<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDownRight, ArrowUpRight, CalendarClock, CalendarDays, History, Layers, UserX, Wallet } from '@lucide/vue';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import type { SalaryRow } from '@/modules/payroll/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { change } from '@/modules/payroll/utils/run-compare';
import { AppAvatar, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';
import { profileCover } from '@/shared/utils/profile-cover';

/** An employee's salary as a profile card: annual CTC, its monthly split, when it took effect, any scheduled revision and the actions. */
const props = defineProps<{ row: SalaryRow; segments: PaySegment[]; canRevise: boolean }>();
const emit = defineEmits<{ history: []; revise: [] }>();

const e = computed(() => props.row.employee);
const s = computed(() => props.row.current);
const up = computed(() => props.row.upcoming);
const revision = computed(() => (up.value && s.value ? change(up.value.annualCtc, s.value.annualCtc) : null));
const headline = computed(() => [e.value.designation, e.value.department].filter(Boolean).join(' · ') || 'No role on file');
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="relative -mx-4 -mt-4 h-14 border-b border-line/50" :style="profileCover(e.id)" aria-hidden="true">
      <span v-if="s?.structure.name" class="absolute end-2.5 top-2.5 inline-flex max-w-[60%] items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-2xs font-medium text-fg-muted shadow-xs backdrop-blur-sm">
        <Layers :size="11" class="shrink-0" /><span class="truncate">{{ s.structure.name }}</span>
      </span>
    </div>
    <div class="relative z-10 -mt-7 flex items-end justify-between gap-2">
      <span class="rounded-full bg-surface p-0.5"><AppAvatar :name="e.name" size="lg" /></span>
      <span v-if="s && !s.pfApplicable" class="mb-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-2xs font-medium text-fg-muted">No PF</span>
    </div>

    <h3 class="mt-2 truncate text-sm font-semibold text-fg">{{ e.name }}</h3>
    <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ e.employeeCode }}</span> · {{ headline }}</p>

    <div v-if="s" class="mt-4">
      <p class="text-2xs font-medium text-fg-subtle">Annual CTC</p>
      <p class="flex items-baseline gap-1.5">
        <span class="text-xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(s.annualCtc) }}</span>
        <span class="text-2xs text-fg-subtle tabular-nums">{{ rupees(s.monthlyCtc) }} a month</span>
      </p>
      <PaySplitBar v-if="segments.length" class="mt-2.5" :segments="segments" :label="`${e.name}'s monthly cost to company`" size="sm" />
    </div>
    <div v-else-if="!up" class="mt-4 flex items-center gap-3 rounded-lg bg-warning-soft/60 px-3 py-2.5 ring-1 ring-warning/20 ring-inset">
      <UserX :size="16" class="shrink-0 text-warning-fg" aria-hidden="true" />
      <div class="min-w-0">
        <p class="text-xs font-semibold text-warning-fg">No salary</p>
        <p class="text-2xs text-fg-muted">Left out of payroll runs until one is set.</p>
      </div>
    </div>

    <p v-if="up" class="mt-3 flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-2xs font-medium text-accent-fg tabular-nums">
      <CalendarClock :size="12" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ s ? 'Revision' : 'Starts' }}: {{ rupees(up.annualCtc) }} from {{ formatDate(up.effectiveFrom) }}</span>
      <span v-if="revision && revision.direction !== 'same'" class="inline-flex shrink-0 items-center gap-0.5 font-semibold">
        <component :is="revision.direction === 'up' ? ArrowUpRight : ArrowDownRight" :size="11" aria-hidden="true" /><span class="sr-only">{{ revision.direction === 'up' ? 'Up' : 'Down' }} </span>{{ revision.pct }}%
      </span>
    </p>

    <dl v-if="s" class="mt-3 grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="text-2xs text-fg-subtle">Monthly gross</dt>
        <dd class="mt-0.5 truncate text-xs font-medium text-fg tabular-nums">{{ rupees(s.monthlyGross) }}</dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="text-2xs text-fg-subtle">Effective</dt>
        <dd class="mt-0.5 truncate text-xs font-medium text-fg" :title="s.reason ?? undefined">{{ formatDate(s.effectiveFrom) }}</dd>
        <dd class="truncate text-2xs text-fg-subtle">{{ s.reason ?? timeAgo(s.effectiveFrom) }}</dd>
      </div>
    </dl>

    <div class="mt-auto pt-4">
      <div class="flex items-center gap-2 border-t border-line/60 pt-3">
        <p class="flex min-w-0 flex-1 items-center gap-1 truncate text-2xs text-fg-subtle"><CalendarDays :size="11" class="shrink-0" aria-hidden="true" />Joined {{ formatDate(e.dateOfJoining) }}</p>
        <AppButton size="xs" variant="ghost" :icon="History" :aria-label="`Salary history of ${e.name}`" title="Salary history" @click.stop="emit('history')" />
        <AppButton v-if="canRevise" size="xs" :variant="s || up ? 'secondary' : 'primary'" :icon="Wallet" @click.stop="emit('revise')">{{ s || up ? 'Revise' : 'Set salary' }}</AppButton>
      </div>
    </div>
  </div>
</template>
