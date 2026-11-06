<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { X } from '@lucide/vue';

const props = withDefaults(defineProps<{ open: boolean; title: string; description?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissible?: boolean }>(), {
  size: 'md',
  dismissible: true,
});
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const titleId = useId();
let previouslyFocused: HTMLElement | null = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function close() {
  if (props.dismissible) emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  } else if (e.key === 'Tab' && panel.value) {
    const items = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      await nextTick();
      const target = panel.value?.querySelector<HTMLElement>('[autofocus]') ?? panel.value?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    } else {
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" @keydown="onKeydown">
      <div class="absolute inset-0 animate-fade-in bg-zinc-950/40 backdrop-blur-sm dark:bg-black/60" aria-hidden="true" @click="close" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :class="[
          'relative flex max-h-[92vh] w-full animate-slide-up flex-col rounded-t-3xl border border-line bg-surface shadow-pop sm:animate-scale-in sm:rounded-2xl',
          { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size],
        ]"
      >
        <div class="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
        <header class="flex items-start justify-between gap-4 px-6 pt-5 pb-1">
          <div>
            <h2 :id="titleId" class="text-lg font-semibold text-fg">{{ title }}</h2>
            <p v-if="description" class="mt-1 text-sm text-fg-muted">{{ description }}</p>
          </div>
          <button
            v-if="dismissible"
            type="button"
            class="-mt-1 -mr-2 rounded-lg p-1.5 text-fg-subtle transition hover:bg-surface-muted hover:text-fg"
            aria-label="Close dialog"
            @click="close"
          >
            <X :size="18" />
          </button>
        </header>
        <div class="overflow-y-auto px-6 py-5">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-muted/40 px-6 py-4 sm:rounded-b-2xl">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
