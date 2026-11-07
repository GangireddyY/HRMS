<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';
import type { RouteLocationRaw } from 'vue-router';

defineProps<{ title: string; description?: string; back?: RouteLocationRaw; backLabel?: string }>();
</script>

<template>
  <div class="mb-4">
    <RouterLink
      v-if="back"
      :to="back"
      class="group mb-1.5 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-fg-muted transition hover:text-fg max-lg:in-[#main]:hidden"
    >
      <ArrowLeft :size="13" class="transition group-hover:-translate-x-0.5" aria-hidden="true" /> {{ backLabel ?? 'Back' }}
    </RouterLink>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <slot name="leading" />
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-xl font-semibold tracking-tight text-fg">{{ title }}</h1>
            <slot name="badges" />
          </div>
          <p v-if="description" class="mt-0.5 max-w-3xl text-[13px] text-fg-muted">{{ description }}</p>
        </div>
      </div>
      <!-- Phones: one row that scrolls sideways instead of a stack of wrapped buttons. -->
      <div
        v-if="$slots.actions"
        class="flex flex-wrap items-center gap-1.5 max-sm:scrollbar-none max-sm:-mx-3 max-sm:w-[calc(100%+1.5rem)] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-3 max-sm:[&>*]:shrink-0"
      >
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
