<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { Check, ChevronDown, Search } from '@lucide/vue';
import AppFormField from '@/shared/components/forms/AppFormField.vue';
import type { SelectOption } from '@/shared/components/types';
import { useFloating, useOutsideClose } from '@/shared/composables/use-floating';

interface Item {
  key: string;
  value: T | null;
  label: string;
  description?: string;
  disabled?: boolean;
  isPlaceholder?: boolean;
}

const props = withDefaults(
  defineProps<{
    label?: string;
    options: SelectOption<T>[];
    placeholder?: string;
    error?: string;
    help?: string;
    required?: boolean;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
    /** Show a search box; defaults to on for lists longer than 10 options. */
    searchable?: boolean;
    /** Offer the placeholder as a "no value" option (defaults to true when a placeholder is set). */
    clearable?: boolean;
    size?: 'sm' | 'md';
    /** Options come from the server for the typed text (`search` event); they are not filtered locally. */
    remote?: boolean;
  }>(),
  { searchable: undefined, clearable: undefined, size: 'md' },
);
const emit = defineEmits<{ search: [query: string] }>();

const model = defineModel<T | null | undefined>();
const autoId = useId();
const selectId = computed(() => props.id ?? autoId);
const listId = computed(() => `${selectId.value}-listbox`);

const open = ref(false);
const query = ref('');
const activeIndex = ref(-1);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const floating = useFloating(trigger, open, { maxHeight: 300 });

const isSearchable = computed(() => props.searchable ?? props.options.length > 10);
const allowsEmpty = computed(() => props.clearable ?? props.placeholder !== undefined);
const selected = computed(() => props.options.find((o) => o.value === model.value));

const items = computed<Item[]>(() => [
  ...(allowsEmpty.value ? [{ key: '__empty', value: null, label: props.placeholder ?? 'None', isPlaceholder: true }] : []),
  ...props.options.map((o) => ({ key: String(o.value), value: o.value, label: o.label, description: o.description, disabled: o.disabled })),
]);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (props.remote) return items.value.filter((i) => !q || !i.isPlaceholder);
  return q ? items.value.filter((i) => !i.isPlaceholder && i.label.toLowerCase().includes(q)) : items.value;
});

const optionId = (i: number) => `${listId.value}-${i}`;
const isSelected = (item: Item) => (item.isPlaceholder ? model.value === null || model.value === undefined : item.value === model.value);

function firstEnabled(from: number, step: 1 | -1): number {
  const list = filtered.value;
  for (let i = from; i >= 0 && i < list.length; i += step) if (!list[i]!.disabled) return i;
  return activeIndex.value;
}

async function openMenu(at: 'selected' | 'first' | 'last' = 'selected') {
  if (props.disabled || open.value) return;
  query.value = '';
  open.value = true;
  const current = filtered.value.findIndex(isSelected);
  activeIndex.value = at === 'last' ? firstEnabled(filtered.value.length - 1, -1) : at === 'first' || current < 0 ? firstEnabled(0, 1) : current;
  await nextTick();
  if (isSearchable.value) searchInput.value?.focus();
}

function close(refocus = true) {
  if (!open.value) return;
  open.value = false;
  if (refocus) trigger.value?.focus();
}

function choose(item: Item | undefined) {
  if (!item || item.disabled) return;
  model.value = item.value;
  close();
}

useOutsideClose([trigger, panel], open, () => close(false));

watch(query, (q) => {
  activeIndex.value = firstEnabled(0, 1);
  emit('search', q);
});
watch(
  () => props.options,
  () => {
    if (props.remote && open.value) activeIndex.value = firstEnabled(0, 1);
  },
);
watch(activeIndex, async (i) => {
  if (!open.value || i < 0) return;
  await nextTick();
  document.getElementById(optionId(i))?.scrollIntoView?.({ block: 'nearest' });
});

let typed = '';
let typedTimer: ReturnType<typeof setTimeout> | undefined;
function typeAhead(char: string) {
  typed += char.toLowerCase();
  clearTimeout(typedTimer);
  typedTimer = setTimeout(() => (typed = ''), 600);
  const start = typed.length === 1 ? activeIndex.value + 1 : activeIndex.value;
  const list = filtered.value;
  for (let n = 0; n < list.length; n++) {
    const i = (start + n) % list.length;
    if (!list[i]!.disabled && list[i]!.label.toLowerCase().startsWith(typed)) {
      activeIndex.value = i;
      return;
    }
  }
}

/** Shared list navigation for the trigger (select-only) and the search box (searchable). */
function navigate(e: KeyboardEvent): boolean {
  const list = filtered.value;
  switch (e.key) {
    case 'ArrowDown':
      activeIndex.value = firstEnabled(Math.min(activeIndex.value + 1, list.length - 1), 1);
      return true;
    case 'ArrowUp':
      activeIndex.value = firstEnabled(Math.max(activeIndex.value - 1, 0), -1);
      return true;
    case 'Home':
      activeIndex.value = firstEnabled(0, 1);
      return true;
    case 'End':
      activeIndex.value = firstEnabled(list.length - 1, -1);
      return true;
    case 'Enter':
      choose(list[activeIndex.value]);
      return true;
    case 'Escape':
      e.stopPropagation();
      close();
      return true;
    case 'Tab':
      close();
      return true;
    default:
      return false;
  }
}

function onTriggerKey(e: KeyboardEvent) {
  if (!open.value) {
    if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      void openMenu();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      void openMenu('last');
    }
    return;
  }
  if (e.key === ' ' && !isSearchable.value) {
    e.preventDefault();
    choose(filtered.value[activeIndex.value]);
  } else if (navigate(e)) {
    if (e.key !== 'Tab') e.preventDefault();
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    typeAhead(e.key);
  }
}

function onSearchKey(e: KeyboardEvent) {
  if (navigate(e)) e.preventDefault();
}
</script>

<template>
  <AppFormField :id="selectId" :label="label" :error="error" :help="help" :required="required">
    <template #default="{ describedby, invalid }">
      <button
        :id="selectId"
        ref="trigger"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="open && !isSearchable && activeIndex >= 0 ? optionId(activeIndex) : undefined"
        :aria-label="label ? undefined : ariaLabel"
        :aria-labelledby="label ? `${selectId}-label ${selectId}-value` : undefined"
        :aria-invalid="invalid || undefined"
        :aria-required="required || undefined"
        :aria-describedby="describedby"
        :disabled="disabled"
        :class="[
          'input-base flex cursor-pointer items-center gap-2 text-start disabled:cursor-not-allowed',
          size === 'sm' && 'min-h-8 py-1 text-sm',
          invalid && 'input-invalid',
          open && !invalid && 'border-brand-500 ring-2 ring-brand-500/20',
        ]"
        @click="open ? close() : openMenu()"
        @keydown="onTriggerKey"
      >
        <span :id="`${selectId}-value`" :class="['min-w-0 flex-1 truncate', !selected && 'text-fg-subtle']">{{ selected?.label ?? placeholder ?? 'Select…' }}</span>
        <ChevronDown :size="size === 'sm' ? 14 : 16" :class="['shrink-0 text-fg-subtle transition-transform duration-200', open && 'rotate-180']" aria-hidden="true" />
      </button>

      <Teleport to="body">
        <Transition
          enter-active-class="transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
          :enter-from-class="floating.placement.value === 'top' ? 'opacity-0 translate-y-1 scale-[0.98]' : 'opacity-0 -translate-y-1 scale-[0.98]'"
          leave-active-class="transition duration-100"
          leave-to-class="opacity-0"
        >
          <div
            v-if="open"
            ref="panel"
            :style="{ ...floating.style.value, minWidth: '12rem' }"
            class="z-[70] flex flex-col overflow-hidden rounded-xl border border-line bg-surface-raised shadow-pop"
          >
            <div v-if="isSearchable" class="border-b border-line p-2">
              <div class="relative">
                <Search :size="15" class="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
                <input
                  ref="searchInput"
                  v-model="query"
                  type="text"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  :aria-controls="listId"
                  :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
                  :aria-label="`Search ${label ?? ariaLabel ?? 'options'}`"
                  placeholder="Search…"
                  class="h-8 w-full rounded-md bg-surface-muted pe-2 ps-8 text-sm text-fg outline-none placeholder:text-fg-subtle focus:ring-2 focus:ring-brand-500/20"
                  @keydown="onSearchKey"
                />
              </div>
            </div>
            <ul
              :id="listId"
              role="listbox"
              :aria-labelledby="label ? `${selectId}-label` : undefined"
              :aria-label="label ? undefined : ariaLabel"
              class="flex-1 overflow-y-auto p-2"
              @mousedown.prevent
            >
              <li
                v-for="(item, i) in filtered"
                :id="optionId(i)"
                :key="item.key"
                role="option"
                :aria-selected="isSelected(item)"
                :aria-disabled="item.disabled || undefined"
                :class="[
                  'flex cursor-pointer items-center gap-2 rounded-lg px-3 text-sm transition-colors',
                  'py-2',
                  i === activeIndex && 'bg-surface-muted',
                  isSelected(item) ? 'font-medium text-fg' : item.isPlaceholder ? 'text-fg-muted' : 'text-fg',
                  item.disabled && 'cursor-not-allowed opacity-45',
                ]"
                @mouseenter="activeIndex = i"
                @click="choose(item)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ item.label }}</span>
                  <span v-if="item.description" class="block truncate text-xs font-normal text-fg-subtle">{{ item.description }}</span>
                </span>
                <Check v-if="isSelected(item)" :size="15" class="shrink-0 text-accent-fg" aria-hidden="true" />
              </li>
              <li v-if="!filtered.length" class="px-3 py-6 text-center text-sm text-fg-muted" role="presentation">No matches</li>
            </ul>
          </div>
        </Transition>
      </Teleport>
    </template>
  </AppFormField>
</template>
