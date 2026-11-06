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
    <div
      role="tablist"
      :class="['inline-flex max-w-full gap-1 self-start overflow-x-auto rounded-xl bg-surface-muted p-1 ring-1 ring-line/60 ring-inset', fill ? 'mb-5 shrink-0' : 'mb-6']"
    >
      <button
        v-for="(t, i) in tabs"
        :id="`${id}-${t.key}`"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="model === t.key"
        :tabindex="model === t.key ? 0 : -1"
        :class="[
          'rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition',
          model === t.key ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line/60' : 'text-fg-muted hover:text-fg',
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
