<script setup lang="ts">
import { ref, type Component } from 'vue';
import { ChevronDown } from '@lucide/vue';
import { useFloating, useOutsideClose } from '@/shared/composables/use-floating';

/** A toolbar filter button with a panel that stays open while boxes are ticked; closes on Escape or outside click. */
const props = withDefaults(defineProps<{ label: string; icon?: Component; active?: boolean; summary?: string; width?: number }>(), { icon: undefined, summary: undefined, width: 280 });
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const floating = useFloating(trigger, open, { width: props.width, maxHeight: 420 });
useOutsideClose([trigger, panel], open, () => (open.value = false));
function close() {
  open.value = false;
  trigger.value?.focus();
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :class="[
      'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium whitespace-nowrap shadow-xs transition focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
      active ? 'border-brand-300 bg-accent-soft text-accent-fg dark:border-brand-500/40' : 'border-line bg-surface text-fg hover:bg-surface-muted',
    ]"
    @click="open = !open"
  >
    <component :is="icon" v-if="icon" class="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
    {{ label }}
    <span v-if="summary" class="rounded-full bg-brand-600 px-1.5 text-2xs font-semibold text-white tabular-nums">{{ summary }}</span>
    <ChevronDown :class="['h-3.5 w-3.5 shrink-0 opacity-70 transition', open && 'rotate-180']" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <Transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0 scale-[0.98]" leave-active-class="transition duration-100" leave-to-class="opacity-0">
      <div v-if="open" ref="panel" role="dialog" :aria-label="label" :style="floating.style.value" class="z-[70] flex flex-col overflow-hidden rounded-lg border border-line bg-surface-raised shadow-pop" @keydown.esc.stop="close">
        <slot :close="close" />
      </div>
    </Transition>
  </Teleport>
</template>
