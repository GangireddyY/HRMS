<script setup lang="ts">
withDefaults(defineProps<{ lines?: number; lineClass?: string }>(), { lines: 1, lineClass: 'h-4' });
</script>

<template>
  <div role="status" aria-label="Loading" class="space-y-2.5">
    <div
      v-for="i in lines"
      :key="i"
      :class="['animate-pulse rounded-full bg-surface-muted', lineClass, i === lines && lines > 1 ? 'w-2/3' : i % 2 === 0 ? 'w-11/12' : 'w-full']"
    />
  </div>
</template>
