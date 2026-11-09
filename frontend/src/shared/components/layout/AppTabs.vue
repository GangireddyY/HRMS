<script setup lang="ts">
import { useId, type Component } from 'vue';

/**
 * `fill`: on large screens the panel takes the remaining height of a flex column parent. The `actions` slot sits at the
 * end of the tab row (view filters that apply to every tab). A tab can show an icon and a count.
 */
defineProps<{ tabs: { key: string; label: string; icon?: Component; count?: number | null }[]; fill?: boolean }>();
const model = defineModel<string>({ required: true });
const id = useId();

function onKey(e: KeyboardEvent, tabs: { key: string }[], index: number) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  model.value = tabs[next].key;
  (document.getElementById(`${id}-${tabs[next].key}`) as HTMLElement | null)?.focus();
}
</script>

<template>
  <div :class="fill && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col'">
    <div :class="['flex items-end gap-3 border-b border-line', fill ? 'mb-4 shrink-0' : 'mb-4']">
    <div role="tablist" class="-mb-px flex min-w-0 flex-1 gap-5 overflow-x-auto">
      <button
        v-for="(t, i) in tabs"
        :id="`${id}-${t.key}`"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="model === t.key"
        :tabindex="model === t.key ? 0 : -1"
        :class="[
          '-mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 pt-1 pb-2 text-sm whitespace-nowrap transition-colors focus-visible:rounded-sm focus-visible:outline-offset-0',
          model === t.key
            ? 'border-brand-600 font-semibold text-accent-fg dark:border-brand-400'
            : 'border-transparent font-medium text-fg-muted hover:border-line-strong hover:text-fg',
        ]"
        @click="model = t.key"
        @keydown="onKey($event, tabs, i)"
      >
        <component :is="t.icon" v-if="t.icon" :size="15" aria-hidden="true" />
        {{ t.label }}
        <span
          v-if="t.count !== undefined && t.count !== null"
          :class="['rounded-full px-1.5 text-2xs leading-4 font-semibold tabular-nums', model === t.key ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-muted']"
        >
          {{ t.count }}
        </span>
      </button>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2 pb-1.5"><slot name="actions" /></div>
    </div>
    <div role="tabpanel" :class="fill && 'lg:min-h-0 lg:flex-1'"><slot /></div>
  </div>
</template>
