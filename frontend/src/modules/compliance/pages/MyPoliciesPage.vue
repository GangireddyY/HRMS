<script setup lang="ts">
import { computed } from 'vue';
import { ChevronRight, ScrollText } from '@lucide/vue';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import { ACK_LABELS, POLICY_CATEGORY_LABELS, ackTone } from '@/modules/compliance/utils/compliance-format';
import { AppBadge, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

const mine = useAsync(() => complianceApi.mine());
const toDo = computed(() => (mine.data.value ?? []).filter((p) => p.state === 'PENDING' || p.state === 'OVERDUE'));
const others = computed(() => (mine.data.value ?? []).filter((p) => !toDo.value.includes(p)));
</script>

<template>
  <div>
    <AppPageHeader title="Policies" description="Company policies that apply to you. Read them and confirm you have." />
    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="6" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="mine.data.value">
      <div class="mb-4 grid gap-4 sm:grid-cols-3">
        <AppStatCard label="To acknowledge" :value="toDo.length" tone="warning" />
        <AppStatCard label="Overdue" :value="toDo.filter((p) => p.state === 'OVERDUE').length" tone="danger" />
        <AppStatCard label="Policies" :value="mine.data.value.length" />
      </div>
      <AppCard v-if="!mine.data.value.length"><AppEmptyState :icon="ScrollText" title="No policies yet" description="Policies published by your organization appear here." /></AppCard>
      <div v-else class="space-y-4">
        <AppCard v-for="group in [{ title: 'To acknowledge', items: toDo }, { title: 'All policies', items: others }].filter((g) => g.items.length)" :key="group.title" :title="group.title" :padded="false">
          <ul class="divide-y divide-line">
            <li v-for="p in group.items" :key="p.id">
              <RouterLink :to="`/me/policies/${p.id}`" class="flex items-center gap-4 px-4 py-4 transition hover:bg-surface-muted/50">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-fg">{{ p.title }}</p>
                  <p class="text-xs text-fg-muted">
                    {{ POLICY_CATEGORY_LABELS[p.category] }} · version {{ p.version.version }}<template v-if="p.version.effectiveFrom">, in force from {{ formatDate(p.version.effectiveFrom) }}</template>
                    <template v-if="p.state === 'ACKNOWLEDGED' && p.acknowledgedAt"> · acknowledged {{ formatDate(p.acknowledgedAt) }}</template>
                    <template v-else-if="p.dueOn && p.state !== 'ACKNOWLEDGED'"> · due by {{ formatDate(p.dueOn) }}</template>
                  </p>
                </div>
                <AppBadge v-if="p.state" :tone="ackTone[p.state]" dot>{{ ACK_LABELS[p.state] }}</AppBadge>
                <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </AppCard>
      </div>
    </template>
  </div>
</template>
