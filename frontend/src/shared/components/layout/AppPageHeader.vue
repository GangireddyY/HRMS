<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';
import type { RouteLocationRaw } from 'vue-router';

defineProps<{ title: string; description?: string; back?: RouteLocationRaw; backLabel?: string }>();
</script>

<template>
  <div class="mb-7">
    <RouterLink
      v-if="back"
      :to="back"
      class="group mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-fg-muted transition hover:text-fg"
    >
      <ArrowLeft :size="14" class="transition group-hover:-translate-x-0.5" aria-hidden="true" /> {{ backLabel ?? 'Back' }}
    </RouterLink>
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex min-w-0 items-center gap-4">
        <slot name="leading" />
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <h1 class="text-2xl font-semibold tracking-tight text-fg sm:text-[28px] sm:leading-9">{{ title }}</h1>
            <slot name="badges" />
          </div>
          <p v-if="description" class="mt-1.5 max-w-3xl text-sm text-fg-muted">{{ description }}</p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2 max-sm:w-full"><slot name="actions" /></div>
    </div>
  </div>
</template>
