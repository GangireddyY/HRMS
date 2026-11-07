<script setup lang="ts">
withDefaults(
  defineProps<{ tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet'; dot?: boolean; size?: 'sm' | 'md' }>(),
  { tone: 'neutral', size: 'md' },
);
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-2 rounded-full font-medium whitespace-nowrap ring-1 ring-inset',
      size === 'sm' ? 'px-2 py-px text-2xs' : 'px-2 py-0.5 text-xs',
      {
        neutral: 'bg-surface-muted text-fg-muted ring-line',
        brand: 'bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/12 dark:text-brand-300 dark:ring-brand-400/25',
        success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-400/25',
        warning: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/12 dark:text-amber-300 dark:ring-amber-400/25',
        danger: 'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/12 dark:text-red-300 dark:ring-red-400/25',
        info: 'bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/12 dark:text-sky-300 dark:ring-sky-400/25',
        violet: 'bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/12 dark:text-violet-300 dark:ring-violet-400/25',
      }[tone],
    ]"
  >
    <span
      v-if="dot"
      :class="[
        'h-1.5 w-1.5 rounded-full',
        { neutral: 'bg-fg-subtle', brand: 'bg-brand-500', success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-red-500', info: 'bg-sky-500', violet: 'bg-violet-500' }[tone],
      ]"
      aria-hidden="true"
    />
    <slot />
  </span>
</template>
