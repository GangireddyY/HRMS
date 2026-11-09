<script setup lang="ts">
import type { Component } from 'vue';
import { ArrowRight, ArrowRightLeft, BadgeCheck, Hourglass, TrendingUp, UserCog, UserPlus, Workflow } from '@lucide/vue';
import type { LifecycleEventType } from '@contracts';
import type { LifecycleEvent } from '@/modules/people/types';
import { relativeDays } from '@/modules/people/utils/dates';
import { CHANGE_FIELD_LABELS, LIFECYCLE_LABELS } from '@/modules/people/utils/labels';
import { formatDate, formatDateTime } from '@/shared/utils/format';
import { statusLabel } from '@/shared/utils/status';

/** Lifecycle events newest first, each with its own icon, the fields that changed (from → to), the note and who recorded it. */
withDefaults(defineProps<{ events: LifecycleEvent[]; compact?: boolean }>(), { compact: false });

const ICONS: Record<LifecycleEventType, { icon: Component; tone: string }> = {
  JOINED: { icon: UserPlus, tone: 'bg-brand-600 text-white' },
  TRANSFER: { icon: ArrowRightLeft, tone: 'bg-info text-white' },
  PROMOTION: { icon: TrendingUp, tone: 'bg-success text-white' },
  MANAGER_CHANGE: { icon: UserCog, tone: 'bg-special text-white' },
  STATUS_CHANGE: { icon: Workflow, tone: 'bg-warning text-white' },
  CONFIRMATION: { icon: BadgeCheck, tone: 'bg-success text-white' },
  PROBATION_EXTENDED: { icon: Hourglass, tone: 'bg-caution text-white' },
};
const value = (field: string, v: unknown) => (v === null || v === undefined ? 'none' : field === 'status' ? statusLabel(String(v)) : /Date$/.test(field) ? formatDate(String(v)) : String(v));
</script>

<template>
  <ol class="relative">
    <li v-for="(e, i) in events" :key="e.id" class="relative flex gap-3" :class="compact ? 'pb-3 last:pb-0' : 'pb-6 last:pb-0'">
      <span v-if="i < events.length - 1" class="absolute top-8 bottom-0 start-[15px] w-px bg-line" aria-hidden="true" />
      <span :class="['relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', ICONS[e.type]?.tone ?? 'bg-brand-600 text-white']" aria-hidden="true">
        <component :is="ICONS[e.type]?.icon ?? Workflow" :size="15" />
      </span>
      <div class="min-w-0 flex-1 pt-1">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p class="text-sm font-medium text-fg">{{ LIFECYCLE_LABELS[e.type] ?? e.type }}</p>
          <p class="text-xs text-fg-subtle">
            <template v-if="compact">{{ formatDate(e.effectiveDate) }}</template>
            <template v-else>Effective {{ formatDate(e.effectiveDate) }} · {{ relativeDays(e.effectiveDate) }}</template>
          </p>
        </div>
        <ul v-if="!compact && Object.keys(e.changes).length" class="mt-2 space-y-1.5">
          <li v-for="(c, field) in e.changes" :key="field" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span class="w-24 shrink-0 text-xs font-medium text-fg-muted">{{ CHANGE_FIELD_LABELS[field] ?? field }}</span>
            <span class="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-fg-muted line-through decoration-fg-subtle/60">{{ value(String(field), c.from) }}</span>
            <ArrowRight :size="13" class="text-fg-subtle rtl:rotate-180" aria-label="changed to" />
            <span class="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-fg">{{ value(String(field), c.to) }}</span>
          </li>
        </ul>
        <p v-else-if="compact && Object.keys(e.changes).length" class="mt-0.5 truncate text-xs text-fg-muted">
          {{ Object.keys(e.changes).map((f) => CHANGE_FIELD_LABELS[f] ?? f).join(', ') }} changed
        </p>
        <blockquote v-if="e.note && !compact" class="mt-2 border-s-2 border-line ps-3 text-sm text-fg-muted italic">{{ e.note }}</blockquote>
        <p v-if="!compact" class="mt-2 text-xs text-fg-subtle">{{ e.createdBy ? `By ${e.createdBy}` : 'System' }} · {{ formatDateTime(e.createdAt) }}</p>
      </div>
    </li>
  </ol>
</template>
