<script setup lang="ts">
import { computed } from 'vue';
import { Check, Package } from '@lucide/vue';
import type { Subscription } from '@/modules/organization/types';
import { AppButton, AppCard, AppSkeleton } from '@/shared/components';

/** The subscription plan: seats used against the limit, and the business modules it includes. */
const props = defineProps<{ subscription: Subscription | null; loading?: boolean; settingsTo?: string }>();

const seats = computed(() => {
  const s = props.subscription;
  if (!s) return null;
  const max = s.plan.maxUsers;
  const pct = max ? Math.min(100, Math.round((s.userCount / max) * 100)) : null;
  return { used: s.userCount, max, pct, bar: pct === null ? '' : pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warning' : 'bg-brand-500' };
});
const modules = computed(() => (props.subscription?.modules ?? []).filter((m) => !m.core));
const included = computed(() => modules.value.filter((m) => m.entitled));
</script>

<template>
  <AppCard title="Plan and usage" :description="subscription ? `${subscription.plan.name} plan` : 'Your subscription'" :icon="Package" fill>
    <template v-if="settingsTo" #actions><AppButton size="sm" variant="ghost" :to="settingsTo">Details</AppButton></template>
    <AppSkeleton v-if="loading" :lines="5" />
    <p v-else-if="!subscription" class="text-sm text-fg-muted">Plan details could not be loaded.</p>
    <template v-else>
      <p v-if="subscription.plan.description" class="text-sm text-fg-muted">{{ subscription.plan.description }}</p>
      <div v-if="seats" class="mt-3">
        <div class="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
          <span class="font-medium text-fg-muted">Seats used</span>
          <span class="text-fg tabular-nums"><span class="text-sm font-semibold">{{ seats.used }}</span>{{ seats.max ? ` of ${seats.max}` : ' · no limit' }}</span>
        </div>
        <div v-if="seats.pct !== null" class="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="seats.used" :aria-valuemin="0" :aria-valuemax="seats.max ?? undefined" aria-label="Seats used">
          <div :class="['h-full rounded-full transition-[width] duration-500', seats.bar]" :style="{ width: `${Math.max(2, seats.pct)}%` }" />
        </div>
      </div>
      <div class="mt-4 border-t border-line/70 pt-3">
        <p class="mb-2 text-xs font-medium text-fg-muted">
          Modules <span class="tabular-nums">{{ included.length }} of {{ modules.length }}</span> included
        </p>
        <ul class="flex flex-wrap gap-1.5">
          <li v-for="m in modules" :key="m.key" :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset', m.entitled ? 'bg-success-soft text-success-fg ring-success/20' : 'text-fg-subtle ring-line']" :title="m.description">
            <Check v-if="m.entitled" :size="11" aria-hidden="true" />{{ m.name }}<span class="sr-only">{{ m.entitled ? ' (included)' : ' (not in plan)' }}</span>
          </li>
        </ul>
      </div>
    </template>
  </AppCard>
</template>
