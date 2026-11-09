<script setup lang="ts">
import { computed } from 'vue';
import { CalendarRange, ChevronRight, Clock, Layers, ShieldCheck, Star, Users, Wallet } from '@lucide/vue';
import type { BenefitType } from '@contracts';
import type { Plan } from '@/modules/benefits/types';
import { BENEFIT_TYPE_VISUALS } from '@/modules/benefits/utils/benefit-visuals';
import { PLAN_STATUS_LABELS, TYPE_LABELS, inr, planTone } from '@/modules/benefits/utils/benefits-format';
import { enrolmentWindow, policyTiming } from '@/modules/benefits/utils/plan-window';
import { AppBadge } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** A benefit plan in the grid: a cover tinted by benefit type, its enrolment window, who is covered and what it costs each month. */
const props = defineProps<{ plan: Plan }>();

const ACCENT: Record<BenefitType, string> = {
  HEALTH: 'var(--status-danger)',
  LIFE: 'var(--status-special)',
  ACCIDENT: 'var(--status-warning)',
  WELLNESS: 'var(--status-success)',
  MEAL: 'var(--status-caution)',
  TRANSPORT: 'var(--status-info)',
  OTHER: 'var(--status-neutral)',
};
const p = computed(() => props.plan);
const visual = computed(() => BENEFIT_TYPE_VISUALS[p.value.type]);
const accent = computed(() => ACCENT[p.value.type]);
const tint = (amount: number) => `color-mix(in oklab, ${accent.value} ${amount}%, var(--app-surface))`;
const cover = computed(() => ({
  backgroundImage: [`radial-gradient(120% 170% at 100% 0%, color-mix(in oklab, ${accent.value} 22%, transparent), transparent 62%)`, `linear-gradient(135deg, ${tint(14)}, ${tint(4)})`].join(', '),
}));
const ink = computed(() => ({ color: `color-mix(in oklab, ${accent.value} 78%, var(--app-text))` }));
const watermark = computed(() => ({ color: `color-mix(in oklab, ${accent.value} 26%, transparent)` }));

const win = computed(() => enrolmentWindow(p.value));
const closingSoon = computed(() => win.value.state === 'open' && (win.value.daysLeft ?? 99) <= 7);
const WINDOW_DOT = { open: 'bg-success', upcoming: 'bg-info', closed: 'bg-line-strong', none: 'bg-line-strong' };
const employer = computed(() => p.value.stats?.employerMonthly ?? 0);
const total = computed(() => employer.value + (p.value.stats?.employeeMonthly ?? 0));
const employerPct = computed(() => (total.value ? Math.round((employer.value / total.value) * 100) : 0));
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="relative -mx-4 -mt-4 h-20 overflow-hidden border-b border-line/50" :style="cover">
      <component :is="visual.icon" :size="88" :stroke-width="1.25" class="absolute -end-2 -bottom-5 -rotate-12" :style="watermark" aria-hidden="true" />
      <span
        :class="['absolute end-2.5 top-2.5 inline-flex max-w-[75%] items-center gap-1.5 rounded-full bg-surface/90 px-2 py-0.5 text-2xs font-medium shadow-xs backdrop-blur-sm', closingSoon ? 'text-warning-fg' : 'text-fg-muted']"
      >
        <span :class="['h-1.5 w-1.5 shrink-0 rounded-full', WINDOW_DOT[win.state]]" aria-hidden="true" />
        <span class="truncate">{{ win.label }}<template v-if="win.state === 'open' || win.state === 'upcoming'"> · {{ win.detail }}</template></span>
      </span>
    </div>
    <div class="relative z-10 -mt-6 flex items-end justify-between gap-2">
      <span class="grid h-12 w-12 place-items-center rounded-xl bg-surface shadow-xs ring-1 ring-line/70" :style="ink" aria-hidden="true">
        <component :is="visual.icon" :size="22" />
      </span>
      <AppBadge class="mb-0.5" :tone="planTone[p.status]" size="sm" dot>{{ PLAN_STATUS_LABELS[p.status] }}</AppBadge>
    </div>

    <h3 class="mt-3 line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ p.name }}</h3>
    <p class="mt-0.5 truncate text-xs text-fg-muted">{{ [TYPE_LABELS[p.type], p.provider].filter(Boolean).join(' · ') }}</p>

    <ul class="mt-3 flex flex-wrap gap-1.5 text-2xs" aria-label="Plan details">
      <li v-if="p.mandatory" class="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 font-medium text-info-fg"><Star :size="11" aria-hidden="true" />Mandatory</li>
      <li v-if="p.requiresApproval" class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-fg-muted"><ShieldCheck :size="11" aria-hidden="true" />HR approves</li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-fg-muted"><Layers :size="11" aria-hidden="true" />{{ p.options.length }} option{{ p.options.length === 1 ? '' : 's' }}</li>
      <li v-if="p.waitingDays" class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-fg-muted"><Clock :size="11" aria-hidden="true" />{{ p.waitingDays }}-day wait</li>
    </ul>

    <dl class="mt-3 grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><Users :size="11" aria-hidden="true" />Covered</dt>
        <dd class="mt-0.5 text-base leading-6 font-semibold text-fg tabular-nums">{{ p.stats?.enrolled ?? 0 }}</dd>
        <dd v-if="p.stats?.pending" class="truncate text-2xs font-medium text-warning-fg tabular-nums">+{{ p.stats.pending }} waiting</dd>
        <dd v-else-if="p.stats?.waived" class="truncate text-2xs text-fg-subtle tabular-nums">{{ p.stats.waived }} waived</dd>
        <dd v-else class="text-2xs text-fg-subtle">employees</dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><Wallet :size="11" aria-hidden="true" />Monthly cost</dt>
        <dd class="mt-0.5 truncate text-base leading-6 font-semibold text-fg tabular-nums">{{ inr(total) }}</dd>
        <dd>
          <div class="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden="true">
            <span class="h-full bg-brand-500" :style="{ width: `${total ? 100 - employerPct : 0}%` }" />
            <span class="h-full bg-special" :style="{ width: `${employerPct}%` }" />
          </div>
          <p class="mt-1 truncate text-2xs text-fg-muted tabular-nums" :title="`Employer pays ${inr(employer)} a month`">employer {{ employerPct }}%</p>
        </dd>
      </div>
    </dl>

    <div class="mt-auto pt-3">
      <div class="flex items-center gap-2 border-t border-line/60 pt-3 text-xs">
        <CalendarRange :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-fg-muted" :title="`Policy ${formatDate(p.coverageStartsOn)} – ${formatDate(p.coverageEndsOn)}`">
          <span class="text-fg">{{ formatDate(p.coverageStartsOn) }} – {{ formatDate(p.coverageEndsOn) }}</span> · {{ policyTiming(p).toLowerCase() }}
        </span>
        <ChevronRight :size="16" class="shrink-0 text-fg-subtle transition group-hover/card:translate-x-0.5 group-hover/card:text-fg-muted rtl:rotate-180" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>
