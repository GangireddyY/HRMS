<script setup lang="ts">
import { computed } from 'vue';
import { ChevronRight } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { REPORTS } from '@/modules/reports/utils/report-definitions';
import { AppCard, AppEmptyState, AppPageHeader } from '@/shared/components';

const auth = useAuthStore();
const available = computed(() => REPORTS.filter((r) => auth.can(r.permission)));
</script>

<template>
  <div>
    <AppPageHeader title="Reports" description="Figures across the organization (HR reports cover the people within your access). Export any report as CSV." />
    <AppCard v-if="!available.length"><AppEmptyState title="No reports available" description="Your roles do not include report access." /></AppCard>
    <ul v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <li v-for="r in available" :key="r.key">
        <RouterLink :to="`/hr/reports/${r.key}`" class="group flex h-full items-start gap-4 card p-4 transition hover:ring-brand-400">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><component :is="r.icon" :size="18" aria-hidden="true" /></span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-fg">{{ r.title }}</span>
            <span class="mt-1 block text-sm text-fg-muted">{{ r.description }}</span>
          </span>
          <ChevronRight :size="16" class="mt-1 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
