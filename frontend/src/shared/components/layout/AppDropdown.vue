<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

/**
 * Menu button: the trigger slot's button gets `aria-haspopup` / `aria-expanded` / `aria-controls`, the items
 * (buttons and links in the menu) become menu items with roving focus — ↑ ↓ Home End move, Esc closes and returns
 * focus to the trigger, Tab closes. Opening with the keyboard focuses the first item.
 */
withDefaults(defineProps<{ align?: 'left' | 'right'; width?: string; label?: string }>(), { align: 'right', width: 'w-56' });
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuId = useId();
let openedByKeyboard = false;

const triggerButton = () => trigger.value?.querySelector<HTMLElement>('button, [role="button"], a[href]') ?? null;
const items = () => [...(menu.value?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [role="menuitem"]') ?? [])];

function syncTrigger() {
  const b = triggerButton();
  if (!b) return;
  b.setAttribute('aria-haspopup', 'menu');
  b.setAttribute('aria-expanded', String(open.value));
  if (open.value) b.setAttribute('aria-controls', menuId);
  else b.removeAttribute('aria-controls');
}

function focusItem(i: number) {
  const list = items();
  if (!list.length) return;
  list[(i + list.length) % list.length]!.focus();
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false;
    triggerButton()?.focus();
  }
}
function onMenuKey(e: KeyboardEvent) {
  const list = items();
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'ArrowDown') focusItem(at + 1);
  else if (e.key === 'ArrowUp') focusItem(at < 0 ? -1 : at - 1);
  else if (e.key === 'Home') focusItem(0);
  else if (e.key === 'End') focusItem(-1);
  else if (e.key === 'Tab') {
    open.value = false;
    return;
  } else return;
  e.preventDefault();
}
function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') openedByKeyboard = true;
  if (e.key === 'ArrowDown' && !open.value) {
    e.preventDefault();
    open.value = true;
  }
}

watch(open, async (v) => {
  syncTrigger();
  if (v) {
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    await nextTick();
    for (const el of items()) {
      if (!el.getAttribute('role')) el.setAttribute('role', 'menuitem');
      el.setAttribute('tabindex', '-1');
    }
    if (openedByKeyboard) focusItem(0);
  } else {
    document.removeEventListener('mousedown', onDocClick);
    document.removeEventListener('keydown', onKey);
  }
  openedByKeyboard = false;
});
onMounted(syncTrigger);
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onKey);
});
const close = () => (open.value = false);
</script>

<template>
  <div ref="root" class="relative">
    <div ref="trigger" class="contents" @keydown="onTriggerKey">
      <slot name="trigger" :open="open" :toggle="() => (open = !open)" />
    </div>
    <Transition
      enter-active-class="transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      leave-active-class="transition duration-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        :id="menuId"
        ref="menu"
        role="menu"
        :aria-label="label"
        :class="[
          'absolute z-40 mt-2 rounded-xl border border-line bg-surface-raised p-2 shadow-pop',
          width,
          align === 'right' ? 'end-0 origin-top-right' : 'start-0 origin-top-left',
        ]"
        @click="close"
        @keydown="onMenuKey"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </div>
</template>
