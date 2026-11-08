<script setup lang="ts">
import { useId } from 'vue';

defineProps<{ label: string; description?: string; disabled?: boolean }>();
const model = defineModel<boolean>({ default: false });
const id = useId();
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <label :for="id" class="cursor-pointer text-sm font-medium text-fg">{{ label }}</label>
      <p v-if="description" class="mt-0.5 text-xs text-fg-muted">{{ description }}</p>
    </div>
    <button
      :id="id"
      type="button"
      role="switch"
      :aria-checked="model"
      :disabled="disabled"
      :class="[
        'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200',
        'focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        model ? 'bg-brand-600' : 'bg-line-control',
      ]"
      @click="model = !model"
    >
      <span
        :class="[
          'inline-block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
          model ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0',
        ]"
      />
    </button>
  </div>
</template>
