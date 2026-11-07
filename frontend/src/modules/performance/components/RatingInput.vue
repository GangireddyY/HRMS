<script setup lang="ts">
import { computed } from 'vue';

/** 1–5 rating as a radio group, labelled with the cycle's rating labels. */
const props = defineProps<{ labels: string[]; label: string; disabled?: boolean }>();
const model = defineModel<number | null>({ default: null });
const current = computed(() => (model.value ? props.labels[model.value - 1] : null));
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-2" role="radiogroup" :aria-label="label">
      <button
        v-for="n in 5"
        :key="n"
        type="button"
        role="radio"
        :aria-checked="model === n"
        :aria-label="`${n} – ${labels[n - 1]}`"
        :title="labels[n - 1]"
        :disabled="disabled"
        class="h-8 w-8 rounded-lg text-sm font-semibold tabular-nums ring-1 transition disabled:cursor-not-allowed disabled:opacity-60"
        :class="model === n ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-fg-muted ring-line hover:ring-brand-400'"
        @click="model = model === n ? null : n"
      >
        {{ n }}
      </button>
      <span class="ms-1 text-xs text-fg-muted">{{ current ?? 'Not rated' }}</span>
    </div>
  </div>
</template>
