<script setup lang="ts">
import { useId } from 'vue';

/** `fill`: on large screens the panel takes the remaining height of a flex column parent. */
defineProps<{ tabs: { key: string; label: string }[]; fill?: boolean }>();
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
    <div role="tablist" :class="['flex max-w-full gap-5 overflow-x-auto border-b border-line', fill ? 'mb-4 shrink-0' : 'mb-4']">
      <button
        v-for="(t, i) in tabs"
        :id="`${id}-${t.key}`"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="model === t.key"
        :tabindex="model === t.key ? 0 : -1"
        :class="[
          '-mb-px border-b-2 px-0.5 pt-1 pb-2 text-[13px] font-medium whitespace-nowrap transition-colors',
          model === t.key ? 'border-brand-600 text-fg dark:border-brand-400' : 'border-transparent text-fg-muted hover:border-line-strong hover:text-fg',
        ]"
        @click="model = t.key"
        @keydown="onKey($event, tabs, i)"
      >
        {{ t.label }}
      </button>
    </div>
    <div role="tabpanel" :class="fill && 'lg:min-h-0 lg:flex-1'"><slot /></div>
  </div>
</template>
