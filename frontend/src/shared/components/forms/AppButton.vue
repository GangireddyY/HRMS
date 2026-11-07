<script setup lang="ts">
import { computed, type Component } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { Loader2 } from '@lucide/vue';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'outline' | 'link';
    size?: 'xs' | 'sm' | 'md' | 'lg';
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
    disabled?: boolean;
    icon?: Component;
    iconRight?: Component;
    block?: boolean;
    to?: RouteLocationRaw;
    ariaLabel?: string;
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
);

const classes = computed(() => [
  'group/btn relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none',
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px motion-reduce:active:translate-y-0',
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25 disabled:pointer-events-none disabled:opacity-55',
  props.variant === 'link'
    ? 'h-auto rounded-sm px-0 text-sm'
    : {
        xs: 'h-6 rounded-md px-2 text-xs',
        sm: 'h-8 rounded-md px-3 text-xs',
        md: 'h-9 rounded-md px-4 text-sm',
        lg: 'h-10 rounded-md px-5 text-sm',
      }[props.size],
  {
    // Solid buttons: a faint top sheen and inner highlight over the brand color, with a crisp drop shadow.
    primary:
      'bg-brand-600 bg-gradient-to-b from-white/12 to-transparent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(16_24_40/0.14),0_0_0_1px_color-mix(in_oklab,var(--brand-700)_60%,transparent)] hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600',
    secondary: 'border border-line-strong bg-surface text-fg shadow-xs hover:bg-surface-muted',
    outline: 'border border-brand-500/40 text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10',
    ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
    danger: 'bg-red-600 bg-gradient-to-b from-white/12 to-transparent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(16_24_40/0.14),0_0_0_1px_rgb(185_28_28/0.6)] hover:bg-red-700 focus-visible:ring-red-500/25',
    subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/12 dark:text-brand-300 dark:hover:bg-brand-500/20',
    link: 'text-brand-600 underline-offset-4 hover:underline dark:text-brand-400',
  }[props.variant],
  props.block ? 'w-full' : '',
]);
const iconSize = computed(() => (props.size === 'xs' || props.size === 'sm' ? 13 : 15));
</script>

<template>
  <RouterLink v-if="to && !disabled" :to="to" :class="classes" :aria-label="ariaLabel">
    <component :is="icon" v-if="icon" :size="iconSize" aria-hidden="true" />
    <slot />
    <component :is="iconRight" v-if="iconRight" :size="iconSize" aria-hidden="true" />
  </RouterLink>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading || undefined" :aria-label="ariaLabel">
    <Loader2 v-if="loading" :size="iconSize" class="animate-spin" aria-hidden="true" />
    <component :is="icon" v-else-if="icon" :size="iconSize" aria-hidden="true" />
    <slot />
    <component :is="iconRight" v-if="iconRight && !loading" :size="iconSize" aria-hidden="true" />
  </button>
</template>
