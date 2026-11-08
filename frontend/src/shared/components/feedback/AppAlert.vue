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
        error: 'bg-danger-soft text-danger-fg ring-danger/15',
        success: 'bg-success-soft text-success-fg ring-success/15',
        info: 'bg-accent-soft text-accent-fg ring-brand-500/20',
        warning: 'bg-warning-soft text-warning-fg ring-warning/20',
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
