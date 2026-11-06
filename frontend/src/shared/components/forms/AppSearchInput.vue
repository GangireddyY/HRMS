<script setup lang="ts">
import { ref } from 'vue';
import { Search, X } from '@lucide/vue';

withDefaults(defineProps<{ placeholder?: string; ariaLabel?: string; size?: 'sm' | 'md'; shortcut?: string }>(), {
  placeholder: 'Search…',
  ariaLabel: 'Search',
  size: 'md',
});
const model = defineModel<string | null | undefined>();
const input = ref<HTMLInputElement | null>(null);

function clear() {
  model.value = '';
  input.value?.focus();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && model.value) {
    e.stopPropagation();
    clear();
  }
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="relative">
    <Search :size="size === 'sm' ? 14 : 16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
    <input
      ref="input"
      :value="model ?? ''"
      type="search"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      autocomplete="off"
      spellcheck="false"
      :class="['input-base pl-9 [&::-webkit-search-cancel-button]:hidden', size === 'sm' && 'min-h-8 py-1 text-[13px]', model ? 'pr-9' : shortcut ? 'pr-14' : '']"
      @input="model = ($event.target as HTMLInputElement).value"
      @keydown="onKeydown"
    />
    <button
      v-if="model"
      type="button"
      class="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle transition hover:bg-surface-muted hover:text-fg"
      :aria-label="`Clear ${ariaLabel.toLowerCase()}`"
      @click="clear"
    >
      <X :size="14" />
    </button>
    <kbd
      v-else-if="shortcut"
      class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md border border-line bg-surface-muted px-1.5 py-px text-[10px] font-medium text-fg-subtle"
    >
      {{ shortcut }}
    </kbd>
  </div>
</template>
