<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from '@lucide/vue';

withDefaults(defineProps<{ tone?: 'error' | 'success' | 'info' | 'warning'; title?: string }>(), { tone: 'error' });
</script>

<template>
  <div
    :role="tone === 'error' ? 'alert' : 'status'"
    :class="[
      'flex items-start gap-3 rounded-md px-3 py-2 text-sm ring-1 ring-inset',
      {
        error: 'bg-red-50 text-red-800 ring-red-600/15 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-400/20',
        success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/20',
        info: 'bg-brand-50 text-brand-800 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-400/20',
        warning: 'bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20',
      }[tone],
    ]"
  >
    <OctagonAlert v-if="tone === 'error'" :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
    <CheckCircle2 v-else-if="tone === 'success'" :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
    <AlertTriangle v-else-if="tone === 'warning'" :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
    <Info v-else :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
    <div class="min-w-0">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div :class="title && 'mt-0.5 opacity-90'"><slot /></div>
    </div>
  </div>
</template>
