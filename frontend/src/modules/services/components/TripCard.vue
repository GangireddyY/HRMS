<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, BedDouble, CalendarRange, Wallet } from '@lucide/vue';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import type { Trip } from '@/modules/services/types';
import { nights, TRAVEL_MODE_ICONS, TRAVEL_MODE_LABELS, TRAVEL_STATUS_LABELS, travelStatusTone, tripDates } from '@/modules/services/utils/services-format';
import { AppApprovalProgress, AppBadge } from '@/shared/components';

/** A trip at a glance: route, dates, mode, cost and status; actions go in the default slot. */
const props = defineProps<{ trip: Trip; showEmployee?: boolean }>();
const stay = computed(() => nights(props.trip.departureDate, props.trip.returnDate));
</script>

<template>
  <article class="card flex flex-col overflow-hidden">
    <div class="flex items-start gap-3 p-4">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg" aria-hidden="true"><component :is="TRAVEL_MODE_ICONS[trip.mode]" :size="20" /></span>
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-center gap-x-1.5 font-semibold text-fg">
          {{ trip.fromCity }} <ArrowRight :size="14" class="shrink-0 text-fg-subtle rtl:rotate-180" aria-label="to" /> {{ trip.toCity }}
        </p>
        <p class="truncate text-xs text-fg-muted">
          <template v-if="showEmployee && trip.employee">{{ trip.employee.name }} · </template><span class="font-mono">{{ trip.reference }}</span> · {{ TRAVEL_MODE_LABELS[trip.mode] }}
        </p>
        <AppBadge class="mt-1.5" :tone="travelStatusTone[trip.status]" size="sm" dot>{{ TRAVEL_STATUS_LABELS[trip.status] }}</AppBadge>
      </div>
    </div>
    <p class="line-clamp-2 px-4 text-sm text-fg">{{ trip.purpose }}</p>
    <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line/70 px-4 py-3 text-xs">
      <div class="flex items-center gap-2">
        <CalendarRange :size="14" class="text-fg-subtle" aria-hidden="true" />
        <div>
          <dt class="sr-only">Dates</dt>
          <dd class="font-medium text-fg">{{ tripDates(trip) }}</dd>
          <dd class="text-fg-muted">{{ stay === 0 ? 'Day trip' : `${stay} night${stay === 1 ? '' : 's'}` }}{{ trip.needsAccommodation ? ' · hotel' : '' }}</dd>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Wallet :size="14" class="text-fg-subtle" aria-hidden="true" />
        <div>
          <dt class="sr-only">Cost</dt>
          <dd class="font-medium text-fg tabular-nums">{{ rupees(trip.estimatedCost) }} estimate</dd>
          <dd class="text-fg-muted tabular-nums">{{ trip.advanceAmount ? `${rupees(trip.advanceAmount)} advance${trip.advancePaidAt ? ' · paid' : ''}` : 'No advance' }}</dd>
        </div>
      </div>
    </dl>
    <p v-if="trip.bookingNotes" class="flex gap-2 border-t border-line/70 px-4 py-2.5 text-xs whitespace-pre-line text-fg">
      <BedDouble :size="14" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" /><span>{{ trip.bookingNotes }}</span>
    </p>
    <AppApprovalProgress v-if="trip.chain && trip.chain.status !== 'CANCELLED'" :progress="trip.chain" class="border-t border-line/70 px-4 py-3" />
    <p v-if="trip.reviewNote" class="border-t border-line/70 px-4 py-2.5 text-xs text-fg-muted">{{ trip.reviewedBy }}: “{{ trip.reviewNote }}”</p>
    <div v-if="$slots.default" class="mt-auto flex flex-wrap justify-end gap-2 border-t border-line/70 bg-surface-muted/40 px-4 py-2.5"><slot /></div>
  </article>
</template>
