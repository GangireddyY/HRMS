<script setup lang="ts" generic="T extends string">
/** A small switch between a few views or modes (Week / Month, List / Calendar). */
defineProps<{ options: { value: T; label: string }[]; /** Accessible name of the group. */ label: string; size?: 'sm' | 'md' }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div :class="['inline-flex rounded-md bg-surface-muted p-0.5 ring-1 ring-line ring-inset max-sm:w-full', size === 'sm' ? 'h-8' : 'h-9']" role="radiogroup" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :class="[
        'inline-flex flex-1 items-center justify-center rounded-[5px] px-3 font-medium whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
        size === 'sm' ? 'text-xs' : 'text-sm',
        model === o.value ? 'bg-surface text-fg shadow-xs ring-1 ring-line' : 'text-fg-muted hover:text-fg',
      ]"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>
