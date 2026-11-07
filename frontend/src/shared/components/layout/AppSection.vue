<script setup lang="ts">
/** A titled region of a page without card chrome (e.g. a row of KPI tiles). */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <section>
    <div class="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 class="text-sm font-semibold text-fg">{{ title }}</h2>
        <p v-if="description" class="text-xs text-fg-muted">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-1.5"><slot name="actions" /></div>
    </div>
    <slot />
  </section>
</template>
