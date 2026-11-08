<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { AlertCircle, CheckCircle2, Circle, Keyboard, Sparkles } from '@lucide/vue';

/**
 * Side panel of a form page: which required fields are still empty (click to jump to one), errors to fix and the
 * keyboard shortcuts. Reads the form's fields from the DOM, so it works for every form without configuration.
 */
const props = defineProps<{ target: HTMLElement | null }>();
const emit = defineEmits<{ ask: [] }>();

interface FieldState {
  id: string;
  label: string;
  filled: boolean;
}
const fields = ref<FieldState[]>([]);
const errors = ref(0);

function isFilled(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked;
    return el.value.trim() !== '';
  }
  // Custom select and date picker: the value text is muted while it shows the placeholder.
  const value = document.getElementById(`${el.id}-value`);
  return !!value && !value.classList.contains('text-fg-subtle');
}

function labelOf(el: HTMLElement): string {
  const label = el.id ? props.target?.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  const text = (label?.textContent ?? el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '').replace(/\*\s*$/, '').trim();
  return text || 'Field';
}

let frame = 0;
function scan() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const root = props.target;
    if (!root) return;
    const required = [...root.querySelectorAll<HTMLElement>('[required], [aria-required="true"], [data-required]')].filter((el) => el.id && !el.hasAttribute('disabled') && el.getClientRects().length);
    fields.value = required.map((el) => ({ id: el.id, label: labelOf(el), filled: isFilled(el) }));
    errors.value = root.querySelectorAll('.error-text').length;
  });
}

const done = computed(() => fields.value.filter((f) => f.filled).length);
const percent = computed(() => (fields.value.length ? Math.round((done.value / fields.value.length) * 100) : 100));

function focusField(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el?.focus({ preventScroll: true });
}

let observer: MutationObserver | null = null;
onMounted(() => {
  const root = props.target;
  if (!root) return;
  scan();
  observer = new MutationObserver(scan);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled', 'required', 'aria-required', 'data-required'], characterData: true });
  root.addEventListener('input', scan, true);
  root.addEventListener('change', scan, true);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  props.target?.removeEventListener('input', scan, true);
  props.target?.removeEventListener('change', scan, true);
  cancelAnimationFrame(frame);
});
</script>

<template>
  <section class="card ai-ring bg-ai-wash p-4">
    <p class="text-xs font-medium tracking-wide text-fg-muted uppercase">Progress</p>
    <p class="mt-1 text-base font-semibold text-fg">
      <template v-if="!fields.length">Nothing required</template>
      <template v-else-if="done === fields.length">Ready to save</template>
      <template v-else>{{ fields.length - done }} required field{{ fields.length - done === 1 ? '' : 's' }} left</template>
    </p>
    <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100" aria-label="Required fields completed">
      <div class="h-full bg-brand-500 transition-[width] duration-300" :style="{ width: `${percent}%` }" />
    </div>
    <p v-if="errors" class="mt-3 flex items-center gap-2 text-xs font-medium text-danger-fg"><AlertCircle :size="13" aria-hidden="true" />{{ errors }} field{{ errors === 1 ? ' needs' : 's need' }} attention</p>
    <ul v-if="fields.length" class="mt-3 space-y-0.5">
      <li v-for="f in fields" :key="f.id">
        <button type="button" class="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-start text-sm transition hover:bg-surface-muted/70" @click="focusField(f.id)">
          <CheckCircle2 v-if="f.filled" :size="14" class="shrink-0 text-success" aria-hidden="true" />
          <Circle v-else :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span :class="['truncate', f.filled ? 'text-fg-muted' : 'text-fg']">{{ f.label }}</span>
          <span class="sr-only">{{ f.filled ? '(filled)' : '(empty)' }}</span>
        </button>
      </li>
    </ul>
  </section>
  <section class="card p-4 text-xs text-fg-muted">
    <p class="mb-2 flex items-center gap-2 font-medium text-fg"><Keyboard :size="13" aria-hidden="true" />Shortcuts</p>
    <p class="flex justify-between py-0.5">Save <kbd class="rounded-sm border border-line bg-surface-muted px-1 font-mono text-2xs">Ctrl + Enter</kbd></p>
    <p class="flex justify-between py-0.5">Go back <kbd class="rounded-sm border border-line bg-surface-muted px-1 font-mono text-2xs">Esc</kbd></p>
    <button type="button" class="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-line py-2 text-sm font-medium text-fg transition hover:bg-surface-muted" @click="emit('ask')">
      <Sparkles :size="14" class="text-brand-500" aria-hidden="true" />Ask AI for help
    </button>
  </section>
</template>
