<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, useSlots, watch } from 'vue';
import { ArrowLeft, X } from '@lucide/vue';
import { openFormPage } from '@/shared/composables/use-form-page';
import AppFormGuide from './AppFormGuide.vue';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/**
 * Forms open as a page over the content area (the sidebar and top bar stay), using its full width, with Back, the
 * title, the form and an action bar; the browser's Back button and Esc close it. `dialog` keeps a small centred
 * pop-up for confirmations (`size` sets its width). On wide screens a side panel shows the form's progress and
 * shortcuts (`guide`), with anything form-specific from the `aside` slot above it.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    dismissible?: boolean;
    dialog?: boolean;
    guide?: boolean;
    /** Ask before discarding unsaved changes (off for the confirmation dialog itself). */
    guardChanges?: boolean;
  }>(),
  { size: 'md', dismissible: true, dialog: false, guide: true, guardChanges: true },
);
const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
const bodyReady = ref(false);
const slots = useSlots();
const hasFields = ref(false);
const showGuide = computed(() => props.guide && (!!slots.aside || hasFields.value));
const detectFields = () => (hasFields.value = !!body.value?.querySelector(FIELDS));
/** The assistant lives in a feature module; it listens for this event. */
const askAssistant = () => window.dispatchEvent(new CustomEvent('hrms:assistant-open'));

function submitShortcut() {
  const root = panel.value;
  if (!root) return;
  const button = root.querySelector<HTMLButtonElement>('footer button[type="submit"]:not([disabled])');
  if (button) return button.click();
  const form = body.value?.querySelector('form');
  form?.requestSubmit();
}
const titleId = useId();
const host = ref('body');
const inShell = ref(false);
let previouslyFocused: HTMLElement | null = null;
let unregister: (() => void) | null = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELDS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled])';

/**
 * Unsaved changes: a snapshot of the form (field values, ticks, selected options and picker labels) is taken when
 * the user first interacts with it, so data loaded after opening is not counted as a change. Leaving with Esc, Back,
 * the browser's Back button or by closing the tab asks first; an explicit Cancel or a successful save closes as usual.
 */
const feedback = useFeedbackStore();
let baseline: Map<string, string> | null = null;
/** Field state keyed by id (stable across re-renders), so rows added or removed later don't shift the comparison. */
function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  const root = body.value;
  if (!root) return out;
  const key = (el: Element, i: number, kind: string) => el.id || el.getAttribute('name') || `${kind}${i}`;
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el, i) => {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) out.set(key(el, i, 'c'), el.checked ? 'on' : 'off');
    else if (el.type !== 'hidden' && el.type !== 'file') out.set(key(el, i, 'f'), el.value);
  });
  root.querySelectorAll('[role="combobox"], [aria-haspopup], [role="switch"], [role="radio"], [aria-pressed]').forEach((el, i) => {
    out.set(key(el, i, 'w'), `${el.getAttribute('aria-checked') ?? ''}${el.getAttribute('aria-pressed') ?? ''}${el.textContent?.trim() ?? ''}`);
  });
  return out;
}
/** Changed fields that still hold something (an inline form that saved and cleared itself is not a pending change). */
function hasChanges(): boolean {
  if (!baseline) return false;
  const now = snapshot();
  for (const [k, before] of baseline) {
    const value = now.get(k);
    if (value !== undefined && value !== before && value !== '' && value !== 'off') return true;
  }
  return false;
}
let openedAt = 0;
function markInteraction() {
  if (baseline === null) baseline = snapshot();
}
/** Focus counts too, except the automatic focus right after opening (before an edit form's data may have loaded). */
function onFocusIn() {
  if (Date.now() - openedAt > 300) markInteraction();
}
const isDirty = () => props.guardChanges && hasChanges();

let confirming = false;
async function close() {
  if (!props.dismissible || confirming) return;
  if (isDirty()) {
    confirming = true;
    const discard = await feedback.confirm({
      title: 'Discard changes?',
      message: `You have unsaved changes in “${props.title}”. If you leave now, they will be lost.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    });
    confirming = false;
    if (!discard) {
      // The browser's Back already took our history entry off; put one back so Back keeps working.
      if (unregister && props.open) {
        unregister();
        unregister = openFormPage(close);
      }
      return;
    }
  }
  emit('close');
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty()) e.preventDefault();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !props.dialog) {
    e.preventDefault();
    submitShortcut();
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

function release() {
  unregister?.();
  unregister = null;
  baseline = null;
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (props.dialog) document.body.style.overflow = '';
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      inShell.value = !props.dialog && !!document.getElementById('form-pages');
      host.value = inShell.value ? '#form-pages' : 'body';
      baseline = null;
      openedAt = Date.now();
      window.addEventListener('beforeunload', onBeforeUnload);
      if (props.dialog) document.body.style.overflow = 'hidden';
      else if (props.dismissible) unregister = openFormPage(close);
      await nextTick();
      bodyReady.value = true;
      detectFields();
      setTimeout(detectFields, 400);
      // `autofocus` on a field component lands on its wrapper, so focus the first control inside it.
      const auto = panel.value?.querySelector<HTMLElement>('[autofocus]');
      const target =
        (auto && (auto.matches(FOCUSABLE) ? auto : auto.querySelector<HTMLElement>(FIELDS))) ??
        (props.dialog ? null : body.value?.querySelector<HTMLElement>(FIELDS)) ??
        panel.value?.querySelector<HTMLElement>(FOCUSABLE) ??
        panel.value;
      target?.focus({ preventScroll: true });
    } else {
      bodyReady.value = false;
      release();
      previouslyFocused?.focus?.({ preventScroll: true });
    }
  },
  { immediate: true },
);

onBeforeUnmount(release);
</script>

<template>
  <Teleport v-if="open" :to="host">
    <!-- Confirmation pop-up -->
    <div v-if="dialog" class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" @keydown="onKeydown" @pointerdown.capture="markInteraction" @keydown.capture="markInteraction" @focusin="onFocusIn">
      <div class="absolute inset-0 animate-fade-in bg-scrim/40 backdrop-blur-sm dark:bg-scrim/65" aria-hidden="true" @click="close" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        :class="['relative flex max-h-[92vh] w-full animate-slide-up flex-col rounded-t-lg border border-line bg-surface shadow-pop sm:animate-scale-in sm:rounded-lg', { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size]]"
      >
        <header class="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
          <div>
            <h2 :id="titleId" class="text-base font-semibold text-fg">{{ title }}</h2>
            <p v-if="description" class="mt-0.5 text-sm text-fg-muted">{{ description }}</p>
          </div>
          <button v-if="dismissible" type="button" class="-mt-0.5 -me-2 rounded-md p-1 text-fg-subtle transition hover:bg-surface-muted hover:text-fg" aria-label="Close dialog" @click="close">
            <X :size="17" />
          </button>
        </header>
        <div ref="body" class="overflow-y-auto px-4 py-4"><slot /></div>
        <footer v-if="$slots.footer" class="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-muted/40 px-4 py-3 sm:rounded-b-lg"><slot name="footer" /></footer>
      </div>
    </div>

    <!-- Form page -->
    <div
      v-else
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      :class="['z-30 flex animate-fade-in flex-col bg-canvas outline-none', inShell ? 'absolute inset-0' : 'fixed inset-0']"
      @keydown="onKeydown"
      @pointerdown.capture="markInteraction"
      @keydown.capture="markInteraction"
      @focusin="onFocusIn"
    >
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="w-full px-4 py-4 md:px-6 2xl:px-8">
          <button
            v-if="dismissible"
            type="button"
            class="group mb-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-fg-muted transition hover:text-fg"
            @click="close"
          >
            <ArrowLeft :size="13" class="transition group-hover:-translate-x-0.5" aria-hidden="true" /> Back
          </button>
          <h2 :id="titleId" class="text-xl font-semibold tracking-tight text-fg lg:text-2xl">{{ title }}</h2>
          <p v-if="description" class="mt-0.5 text-sm text-fg-muted">{{ description }}</p>
          <div :class="['mt-4 grid items-start gap-4', showGuide && 'xl:grid-cols-[minmax(0,1fr)_300px]']">
            <div ref="body" class="card min-w-0 p-4"><slot /></div>
            <aside v-if="showGuide" class="hidden space-y-4 xl:sticky xl:top-0 xl:block">
              <slot name="aside" />
              <AppFormGuide v-if="bodyReady && hasFields" :target="body" @ask="askAssistant" />
            </aside>
          </div>
        </div>
      </div>
      <footer v-if="$slots.footer" class="glass shrink-0 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 2xl:px-8">
        <div class="flex flex-wrap justify-end gap-2 max-sm:[&>*]:h-10 max-sm:[&>*]:flex-1"><slot name="footer" /></div>
      </footer>
    </div>
  </Teleport>
</template>
