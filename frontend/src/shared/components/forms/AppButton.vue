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
  'group/btn relative inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none',
  'transition-[background-color,border-color,color] duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-55',
  props.variant === 'link'
    ? 'h-auto rounded-sm px-0 text-sm'
    : {
        xs: 'h-6 rounded-md px-2 text-xs',
        sm: 'h-7 rounded-md px-2.5 text-xs',
        md: 'h-8 rounded-md px-3 text-[13px]',
        lg: 'h-10 rounded-md px-4 text-sm',
      }[props.size],
  {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600',
    secondary: 'border border-line-strong bg-surface text-fg hover:bg-surface-muted',
    outline: 'border border-brand-500/40 text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10',
    ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
    danger: 'bg-red-600 text-white hover:bg-red-700',
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
