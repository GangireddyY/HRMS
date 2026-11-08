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
        brand: 'bg-accent-soft text-accent-fg ring-brand-600/15 dark:ring-brand-400/25',
        success: 'bg-success-soft text-success-fg ring-success/15',
        warning: 'bg-warning-soft text-warning-fg ring-warning/20',
        danger: 'bg-danger-soft text-danger-fg ring-danger/15',
        info: 'bg-info-soft text-info-fg ring-info/15',
        violet: 'bg-special-soft text-special-fg ring-special/15',
      }[tone],
    ]"
  >
    <span
      v-if="dot"
      :class="[
        'h-1.5 w-1.5 rounded-full',
        { neutral: 'bg-fg-subtle', brand: 'bg-brand-500', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', violet: 'bg-special' }[tone],
      ]"
      aria-hidden="true"
    />
    <slot />
  </span>
</template>
