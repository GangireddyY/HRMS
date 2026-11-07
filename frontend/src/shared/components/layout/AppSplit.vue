<script setup lang="ts">
/**
 * Main content with a side panel that stays in view while the main column scrolls. The panel stacks under the
 * content below `xl`, so pages use the full width on every screen instead of a narrow centred column.
 */
withDefaults(defineProps<{ aside?: 'sm' | 'md' | 'lg' }>(), { aside: 'md' });
</script>

<template>
  <div :class="['grid items-start gap-4', { sm: 'xl:grid-cols-[minmax(0,1fr)_280px]', md: 'xl:grid-cols-[minmax(0,1fr)_320px]', lg: 'xl:grid-cols-[minmax(0,1fr)_380px]' }[aside]]">
    <div class="min-w-0 space-y-4"><slot /></div>
    <aside v-if="$slots.aside" class="min-w-0 space-y-4 xl:sticky xl:top-0 print:hidden"><slot name="aside" /></aside>
  </div>
</template>
