<script setup lang="ts">
import { useId } from 'vue';

/**
 * Product mark: a person inside the employee-lifecycle ring. Colours follow the active brand theme.
 * Decorative by default; pass `label` when the logo is the only thing naming the product.
 */
withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 32, label: undefined });

const gradientId = `logo-${useId()}`;
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
    class="shrink-0"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop :style="{ stopColor: 'var(--brand-400)' }" />
        <stop offset="1" :style="{ stopColor: 'var(--brand-700)' }" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" :fill="`url(#${gradientId})`" />
    <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" stroke="#fff" stroke-opacity="0.22" />
    <circle cx="16" cy="16" r="10" stroke="#fff" stroke-opacity="0.28" stroke-width="2" />
    <path d="M16 6a10 10 0 1 1-10 10" stroke="#fff" stroke-width="2.2" stroke-linecap="round" />
    <circle cx="6" cy="16" r="2.1" fill="#fff" />
    <circle cx="16" cy="13.4" r="2.7" fill="#fff" />
    <path d="M11.6 21.4a4.4 4.4 0 0 1 8.8 0z" fill="#fff" />
  </svg>
</template>
