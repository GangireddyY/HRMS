<script setup lang="ts">
import { computed } from 'vue';
import { Building2, ChevronRight, GitBranch, MessageSquarePlus, User, Users } from '@lucide/vue';
import type { KeyResult, Objective } from '@/modules/performance/types';
import { OKR_HEALTH_FILL, OKR_HEALTH_LABELS, OKR_LEVEL_LABELS, OKR_STATUS_LABELS, krProgressText, okrHealthTone, okrLevelTone } from '@/modules/performance/utils/performance-format';
import { AppBadge, AppButton } from '@/shared/components';
import { formatMoney } from '@/shared/utils/format';
import { relativeDay } from '@/modules/performance/utils/performance-ops';

/** One objective with its key results; aligned objectives are indented under their parent. */
const props = defineProps<{ objective: Objective & { canEdit?: boolean }; depth?: number; aligned?: number }>();
const emit = defineEmits<{ open: [id: string]; checkIn: [kr: KeyResult, objectiveId: string] }>();

const o = computed(() => props.objective);
const LEVEL_ICON = { COMPANY: Building2, DEPARTMENT: Users, INDIVIDUAL: User } as const;
const ACCENT = { COMPANY: 'before:bg-brand-500', DEPARTMENT: 'before:bg-special', INDIVIDUAL: 'before:bg-info' } as const;
const who = computed(() => (o.value.level === 'COMPANY' ? (o.value.owner?.name ?? 'Whole company') : o.value.level === 'DEPARTMENT' ? (o.value.department?.name ?? 'Department') : (o.value.owner?.name ?? '—')));
const sub = computed(() => [o.value.level === 'DEPARTMENT' && o.value.owner ? `Owner ${o.value.owner.name}` : null, o.value.level === 'INDIVIDUAL' ? o.value.ownerDepartment : null].filter(Boolean).join(' · '));
const CIRC = 2 * Math.PI * 16;
const ring = computed(() => (o.value.health ? { ON_TRACK: 'stroke-success', AT_RISK: 'stroke-warning', OFF_TRACK: 'stroke-danger' }[o.value.health] : 'stroke-brand-500'));
const canCheckIn = computed(() => !!o.value.canEdit && o.value.status === 'ACTIVE');
</script>

<template>
  <article
    :class="[
      'relative overflow-hidden rounded-xl border border-line/80 bg-surface shadow-xs transition before:absolute before:inset-y-0 before:start-0 before:w-1 hover:border-line-strong',
      ACCENT[o.level],
      o.status !== 'ACTIVE' && 'opacity-75',
    ]"
    :style="depth ? { marginInlineStart: `${Math.min(depth, 4) * 1.5}rem` } : undefined"
  >
    <button type="button" class="flex w-full items-start gap-3 px-4 pt-3.5 pb-3 text-start" :aria-label="`Open objective: ${o.title}`" @click="emit('open', o.id)">
      <span :class="['mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', { COMPANY: 'bg-accent-soft text-accent-fg', DEPARTMENT: 'bg-special-soft text-special-fg', INDIVIDUAL: 'bg-info-soft text-info-fg' }[o.level]]" aria-hidden="true">
        <component :is="LEVEL_ICON[o.level]" :size="17" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5">
          <AppBadge size="sm" :tone="okrLevelTone[o.level]">{{ OKR_LEVEL_LABELS[o.level] }}</AppBadge>
          <AppBadge v-if="o.status !== 'ACTIVE'" size="sm" tone="neutral">{{ OKR_STATUS_LABELS[o.status] }}</AppBadge>
          <AppBadge v-if="o.health" size="sm" :tone="okrHealthTone[o.health]" dot>{{ OKR_HEALTH_LABELS[o.health] }}</AppBadge>
          <span v-if="depth" class="inline-flex items-center gap-1 text-2xs text-fg-subtle"><GitBranch :size="11" aria-hidden="true" />Aligned</span>
        </div>
        <h3 class="mt-1 text-sm font-semibold text-fg">{{ o.title }}</h3>
        <p class="truncate text-xs text-fg-muted">
          <span class="font-medium text-fg">{{ who }}</span><template v-if="sub"> · {{ sub }}</template><template v-if="aligned"> · {{ aligned }} aligned</template>
        </p>
      </div>
      <div class="relative h-12 w-12 shrink-0" role="img" :aria-label="`${o.progress}% complete`">
        <svg class="h-full w-full -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="16" fill="none" stroke-width="4" class="stroke-fg/10" />
          <circle cx="20" cy="20" r="16" fill="none" stroke-width="4" stroke-linecap="round" :class="[ring, 'transition-[stroke-dashoffset] duration-700']" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - o.progress / 100)" />
        </svg>
        <span class="absolute inset-0 flex items-center justify-center text-xs font-semibold text-fg tabular-nums">{{ o.progress }}%</span>
      </div>
      <ChevronRight :size="16" class="mt-3 shrink-0 text-fg-subtle rtl:rotate-180" aria-hidden="true" />
    </button>

    <ul v-if="o.keyResults.length" class="divide-y divide-line/60 border-t border-line/60">
      <li v-for="k in o.keyResults" :key="k.id" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:flex-nowrap">
        <div class="min-w-0 flex-1 basis-48">
          <p class="truncate text-sm text-fg" :title="k.title">{{ k.title }}</p>
          <p class="truncate text-2xs text-fg-muted">
            {{ krProgressText(k, formatMoney) }}
            <template v-if="k.weight > 1"> · weight {{ k.weight }}×</template>
            <template v-if="k.lastCheckInAt"> · checked in {{ relativeDay(k.lastCheckInAt) }}</template>
          </p>
        </div>
        <div class="flex w-full items-center gap-2 sm:w-40">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="k.progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`Progress on ${k.title}`">
            <div :class="['h-full rounded-full transition-[width] duration-500', k.progress >= 100 ? 'bg-success' : o.health ? OKR_HEALTH_FILL[o.health] : 'bg-brand-500']" :style="{ width: `${k.progress}%` }" />
          </div>
          <span class="w-9 text-end text-2xs font-semibold text-fg tabular-nums">{{ k.progress }}%</span>
        </div>
        <AppButton v-if="canCheckIn" size="sm" variant="ghost" :icon="MessageSquarePlus" :aria-label="`Check in on ${k.title}`" @click="emit('checkIn', k, o.id)">Check in</AppButton>
      </li>
    </ul>
    <p v-else class="border-t border-line/60 px-4 py-2.5 text-xs text-fg-subtle">No key results yet{{ o.canEdit ? ' · open it to add some' : '' }}</p>
  </article>
</template>
