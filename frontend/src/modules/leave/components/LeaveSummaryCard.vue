<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, CalendarPlus, Plane } from '@lucide/vue';
import { ApiError } from '@/core/http/http-client';
import { leaveApi } from '@/modules/leave/api/leave.api';
import { AppButton, AppCard, AppErrorState, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';

/** Home page summary of the signed-in employee's leave; hidden when they have no employee record or no leave types. */
const balances = useAsync(() => leaveApi.balances());
const noEmployeeRecord = computed(() => balances.error.value instanceof ApiError && balances.error.value.status === 404);
</script>

<template>
  <AppSkeleton v-if="balances.loading.value && !balances.data.value" :lines="2" />
  <AppCard v-else-if="balances.error.value && !noEmployeeRecord" title="Leave" :icon="Plane">
    <AppErrorState :error="balances.error.value" title="Could not load your leave balances" @retry="balances.run" />
  </AppCard>
  <AppCard v-else-if="balances.data.value?.balances.length" title="Leave" :icon="Plane">
    <template #actions>
      <AppButton size="sm" variant="ghost" :icon-right="ArrowRight" to="/me/leave">Details</AppButton>
      <AppButton size="sm" :icon="CalendarPlus" :to="{ path: '/me/leave', query: { apply: '1' } }">Apply</AppButton>
    </template>
    <ul class="flex flex-wrap gap-3">
      <li v-for="b in balances.data.value.balances" :key="b.leaveType.id" class="flex min-w-32 items-center gap-3 rounded-xl bg-surface-muted/60 px-3 py-2">
        <span class="h-8 w-1 rounded-full" :style="{ backgroundColor: b.leaveType.color }" aria-hidden="true" />
        <span>
          <span class="block text-lg leading-tight font-semibold text-fg tabular-nums">{{ b.available ?? '∞' }}</span>
          <span class="block text-xs text-fg-muted">{{ b.leaveType.name }}</span>
        </span>
      </li>
    </ul>
  </AppCard>
</template>
