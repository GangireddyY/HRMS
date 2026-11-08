<script setup lang="ts">
import { useId } from 'vue';
import { Check } from '@lucide/vue';

defineProps<{ label: string; description?: string; disabled?: boolean }>();
const model = defineModel<boolean>({ default: false });
const id = useId();
</script>

<template>
  <div class="flex items-start gap-3">
    <span class="relative mt-0.5 flex h-4 w-4 shrink-0">
      <input
        :id="id"
        v-model="model"
        type="checkbox"
        :disabled="disabled"
        class="peer h-4 w-4 cursor-pointer appearance-none rounded-[3px] border border-line-control bg-surface transition checked:border-brand-600 checked:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Check :size="12" :stroke-width="3" class="pointer-events-none absolute inset-0 m-auto hidden text-white peer-checked:block" aria-hidden="true" />
    </span>
    <label :for="id" :class="['text-sm', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']">
      <span class="font-medium text-fg">{{ label }}</span>
      <span v-if="description" class="mt-0.5 block text-xs text-fg-muted">{{ description }}</span>
    </label>
  </div>
</template>
