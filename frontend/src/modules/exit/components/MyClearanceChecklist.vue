<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Check, ClipboardCheck, Clock, IdCard, Laptop, Minus, UserRound, Users, Wallet } from '@lucide/vue';
import type { ClearanceDepartment } from '@contracts';
import type { ExitDetail } from '@/modules/exit/types';
import { CLEARANCE_LABELS, DEPARTMENT_LABELS, clearanceTone, inr } from '@/modules/exit/utils/exit-format';
import { AppBadge } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** The leaver's own clearance checklist: which team signs off each step and what is still pending (read-only). */
const props = defineProps<{ exit: ExitDetail }>();

const DEPARTMENT_ICONS: Record<ClearanceDepartment, Component> = { MANAGER: Users, IT: Laptop, ADMIN: IdCard, FINANCE: Wallet, HR: UserRound };
const items = computed(() => props.exit.clearanceItems);
const pct = computed(() => (props.exit.clearance.total ? Math.round((props.exit.clearance.done / props.exit.clearance.total) * 100) : 0));
const pending = computed(() => items.value.filter((i) => i.status === 'PENDING').length);
const recoveries = computed(() => items.value.reduce((s, i) => s + i.recoveryAmount, 0));
</script>

<template>
  <section class="card overflow-hidden" aria-labelledby="clearance-title">
    <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
      <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ClipboardCheck :size="16" /></span>
      <div class="min-w-0 flex-1">
        <h2 id="clearance-title" class="text-sm font-semibold text-fg">Clearance checklist</h2>
        <p class="text-xs text-fg-muted">Each team signs off its step before your exit is completed.</p>
      </div>
      <div class="w-full sm:w-48">
        <p class="mb-1 flex justify-between text-2xs text-fg-muted">
          <span>{{ pending ? `${pending} pending` : 'All signed off' }}</span>
          <span class="font-medium text-fg tabular-nums">{{ exit.clearance.done }} of {{ exit.clearance.total }}</span>
        </p>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" aria-label="Clearance progress">
          <div :class="['h-full rounded-full transition-[width] duration-700', pending ? 'bg-brand-500' : 'bg-success']" :style="{ width: `${pct}%` }" />
        </div>
      </div>
    </header>
    <p v-if="!items.length" class="px-4 py-4 text-sm text-fg-muted">Clearance starts when the exit is confirmed.</p>
    <ul v-else class="divide-y divide-line/70">
      <li v-for="i in items" :key="i.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span
          :class="[
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            i.status === 'CLEARED' ? 'bg-success text-white' : i.status === 'PENDING' ? 'bg-warning-soft text-warning-fg ring-1 ring-warning/30 ring-inset' : 'bg-surface-muted text-fg-subtle',
          ]"
          aria-hidden="true"
        >
          <Check v-if="i.status === 'CLEARED'" :size="14" :stroke-width="3" />
          <Clock v-else-if="i.status === 'PENDING'" :size="14" />
          <Minus v-else :size="14" />
        </span>
        <div class="min-w-0 flex-1 basis-56">
          <p :class="['text-sm', i.status === 'NOT_APPLICABLE' ? 'text-fg-muted' : 'font-medium text-fg']">{{ i.title }}</p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
            <span class="inline-flex items-center gap-1"><component :is="DEPARTMENT_ICONS[i.department]" :size="12" aria-hidden="true" />{{ DEPARTMENT_LABELS[i.department] }}</span>
            <template v-if="i.clearedBy && i.clearedAt"><span aria-hidden="true">·</span><span>Signed off by {{ i.clearedBy }}, {{ formatDate(i.clearedAt) }}</span></template>
            <template v-if="i.note"><span aria-hidden="true">·</span><span class="italic">“{{ i.note }}”</span></template>
          </p>
          <p v-if="i.recoveryAmount" class="mt-1 text-xs font-medium text-danger-fg tabular-nums">{{ inr(i.recoveryAmount) }} to be recovered in your settlement</p>
        </div>
        <AppBadge :tone="clearanceTone[i.status]" size="sm" dot>{{ CLEARANCE_LABELS[i.status] }}</AppBadge>
      </li>
    </ul>
    <footer v-if="pending || recoveries" class="border-t border-line/70 bg-surface-muted/50 px-4 py-2.5 text-xs text-fg-muted">
      <template v-if="pending">Pending steps are signed off by the team shown. If one is waiting on you — like returning a device — contact that team.</template>
      <template v-if="recoveries"> {{ inr(recoveries) }} in total will be recovered in your full &amp; final settlement.</template>
    </footer>
  </section>
</template>
