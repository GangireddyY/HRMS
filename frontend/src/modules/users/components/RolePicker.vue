<script setup lang="ts">
import { Check } from '@lucide/vue';
import type { RoleSummary } from '@/modules/roles/types';
import { AppBadge } from '@/shared/components';

defineProps<{ roles: RoleSummary[]; error?: string }>();
const model = defineModel<string[]>({ required: true });

function toggle(id: string) {
  model.value = model.value.includes(id) ? model.value.filter((r) => r !== id) : [...model.value, id];
}
</script>

<template>
  <fieldset>
    <legend class="label flex w-full items-center justify-between">
      <span>Roles <span class="text-red-500" aria-hidden="true">*</span></span>
      <AppBadge v-if="model.length" tone="brand" size="sm">{{ model.length }} selected</AppBadge>
    </legend>
    <div :class="['max-h-64 space-y-1 overflow-y-auto rounded-xl border bg-surface p-1.5', error ? 'border-red-500' : 'border-line']">
      <label
        v-for="r in roles"
        :key="r.id"
        :class="[
          'flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 transition-colors',
          model.includes(r.id) ? 'bg-brand-50/70 dark:bg-brand-500/10' : 'hover:bg-surface-muted',
        ]"
      >
        <span class="relative mt-0.5 flex h-4 w-4 shrink-0">
          <input
            type="checkbox"
            class="peer h-4 w-4 cursor-pointer appearance-none rounded-[5px] border border-line-strong bg-surface shadow-xs transition checked:border-brand-600 checked:bg-brand-600 focus-visible:ring-4 focus-visible:ring-brand-500/20 focus-visible:outline-none"
            :checked="model.includes(r.id)"
            @change="toggle(r.id)"
          />
          <Check :size="12" :stroke-width="3" class="pointer-events-none absolute inset-0 m-auto hidden text-white peer-checked:block" aria-hidden="true" />
        </span>
        <span class="min-w-0">
          <span class="flex items-center gap-1.5 text-sm font-medium text-fg">
            {{ r.name }} <AppBadge v-if="!r.isSystem" tone="info" size="sm">Custom</AppBadge>
          </span>
          <span v-if="r.description" class="block text-xs text-fg-muted">{{ r.description }}</span>
        </span>
      </label>
    </div>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
  </fieldset>
</template>
