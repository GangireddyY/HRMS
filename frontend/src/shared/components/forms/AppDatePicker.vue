<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { CalendarDays, ChevronLeft, ChevronRight, X } from '@lucide/vue';
import AppFormField from '@/shared/components/forms/AppFormField.vue';
import { useFloating, useOutsideClose } from '@/shared/composables/use-floating';

const props = defineProps<{
  label?: string;
  placeholder?: string;
  error?: string;
  help?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  /** Inclusive bounds, `YYYY-MM-DD`. */
  min?: string;
  max?: string;
}>();

/** ISO calendar date `YYYY-MM-DD` (no time zone), matching the API filters. */
const model = defineModel<string | undefined>();
const autoId = useId();
const fieldId = computed(() => props.id ?? autoId);
const gridId = computed(() => `${fieldId.value}-grid`);

const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const floating = useFloating(trigger, open, { width: 296, maxHeight: 400 });
useOutsideClose([trigger, panel], open, () => (open.value = false));

const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fromIso(value: string | null | undefined): Date | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const today = toIso(new Date());
const selected = computed(() => fromIso(model.value));
/** Day with keyboard focus inside the grid. */
const focusDate = ref<Date>(new Date());
const view = computed(() => new Date(focusDate.value.getFullYear(), focusDate.value.getMonth(), 1));

const display = computed(() => (selected.value ? selected.value.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''));
const monthLabel = computed(() => view.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
const weekdays = computed(() => {
  const monday = new Date(2024, 0, 1); // A Monday.
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));
});

/** 6 weeks starting on the Monday on/before the 1st, so the grid height never jumps. */
const weeks = computed(() => {
  const first = view.value;
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const iso = toIso(date);
      return { date, iso, inMonth: date.getMonth() === first.getMonth(), disabled: (!!props.min && iso < props.min) || (!!props.max && iso > props.max) };
    }),
  );
});

const dayId = (iso: string) => `${gridId.value}-${iso}`;

async function focusDay() {
  await nextTick();
  document.getElementById(dayId(toIso(focusDate.value)))?.focus();
}

async function openPicker() {
  if (props.disabled) return;
  focusDate.value = selected.value ?? fromIso(props.max && today > props.max ? props.max : today) ?? new Date();
  open.value = true;
  await focusDay();
}

function close(refocus = true) {
  open.value = false;
  if (refocus) trigger.value?.focus();
}

function pick(iso: string, disabled = false) {
  if (disabled) return;
  model.value = iso;
  close();
}

function clear() {
  model.value = undefined;
}

function shiftMonth(delta: number) {
  const d = focusDate.value;
  const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  focusDate.value = new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
}

function onGridKey(e: KeyboardEvent) {
  const d = focusDate.value;
  const move = (days: number) => (focusDate.value = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
  const handlers: Record<string, () => void> = {
    ArrowLeft: () => move(-1),
    ArrowRight: () => move(1),
    ArrowUp: () => move(-7),
    ArrowDown: () => move(7),
    Home: () => move(-((d.getDay() + 6) % 7)),
    End: () => move(6 - ((d.getDay() + 6) % 7)),
    PageUp: () => shiftMonth(e.shiftKey ? -12 : -1),
    PageDown: () => shiftMonth(e.shiftKey ? 12 : 1),
    Enter: () => pick(toIso(d), weeks.value.flat().find((c) => c.iso === toIso(d))?.disabled),
    ' ': () => pick(toIso(d), weeks.value.flat().find((c) => c.iso === toIso(d))?.disabled),
    Escape: () => close(),
  };
  const handler = handlers[e.key];
  if (!handler) return;
  e.preventDefault();
  e.stopPropagation();
  handler();
  if (open.value) void focusDay();
}

function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' && !open.value) {
    e.preventDefault();
    void openPicker();
  }
}
</script>

<template>
  <AppFormField :id="fieldId" :label="label" :error="error" :help="help" :required="required">
    <template #default="{ describedby, invalid }">
      <div class="relative">
        <button
          :id="fieldId"
          ref="trigger"
          type="button"
          aria-haspopup="dialog"
          :data-required="required || undefined"
          :aria-expanded="open"
          :aria-label="label ? undefined : `${ariaLabel ?? 'Date'}${display ? `, ${display}` : ''}`"
          :aria-labelledby="label ? `${fieldId}-label ${fieldId}-value` : undefined"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          :disabled="disabled"
          :class="[
            'input-base flex cursor-pointer items-center gap-2 pl-9 text-left disabled:cursor-not-allowed',
            model && 'pr-9',
            invalid && 'input-invalid',
            open && !invalid && 'border-brand-500 ring-2 ring-brand-500/20',
          ]"
          @click="open ? close() : openPicker()"
          @keydown="onTriggerKey"
        >
          <span :id="`${fieldId}-value`" :class="['min-w-0 flex-1 truncate', !display && 'text-fg-subtle']">{{ display || placeholder || 'Select date' }}</span>
        </button>
        <CalendarDays :size="16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <button
          v-if="model && !disabled"
          type="button"
          class="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle transition hover:bg-surface-muted hover:text-fg"
          :aria-label="`Clear ${label ?? ariaLabel ?? 'date'}`"
          @click="clear"
        >
          <X :size="14" />
        </button>
      </div>

      <Teleport to="body">
        <Transition enter-active-class="transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]" enter-from-class="opacity-0 scale-[0.98]" leave-active-class="transition duration-100" leave-to-class="opacity-0">
          <div
            v-if="open"
            ref="panel"
            role="dialog"
            :aria-label="`Choose ${label ?? ariaLabel ?? 'date'}`"
            :style="floating.style.value"
            class="z-[70] overflow-hidden rounded-2xl border border-line bg-surface-raised p-3 shadow-pop"
          >
            <div class="mb-2 flex items-center justify-between">
              <button type="button" class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-muted hover:text-fg" aria-label="Previous month" @click="shiftMonth(-1)">
                <ChevronLeft :size="16" />
              </button>
              <p class="text-sm font-semibold text-fg" aria-live="polite">{{ monthLabel }}</p>
              <button type="button" class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-muted hover:text-fg" aria-label="Next month" @click="shiftMonth(1)">
                <ChevronRight :size="16" />
              </button>
            </div>
            <table :id="gridId" role="grid" :aria-label="monthLabel" class="w-full border-collapse" @keydown="onGridKey">
              <thead>
                <tr>
                  <th v-for="(w, i) in weekdays" :key="i" scope="col" class="pb-1 text-center text-[11px] font-medium text-fg-subtle">{{ w }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(week, wi) in weeks" :key="wi">
                  <td v-for="cell in week" :key="cell.iso" class="p-0.5 text-center">
                    <button
                      :id="dayId(cell.iso)"
                      type="button"
                      :tabindex="cell.iso === toIso(focusDate) ? 0 : -1"
                      :aria-selected="cell.iso === model"
                      :aria-current="cell.iso === today ? 'date' : undefined"
                      :aria-label="cell.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })"
                      :disabled="cell.disabled"
                      :class="[
                        'relative mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                        cell.iso === model
                          ? 'bg-brand-600 font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]'
                          : cell.inMonth
                            ? 'text-fg hover:bg-surface-muted'
                            : 'text-fg-subtle/70 hover:bg-surface-muted',
                        cell.iso === today && cell.iso !== model && 'font-semibold text-brand-600 dark:text-brand-400',
                        cell.disabled && 'pointer-events-none opacity-30',
                      ]"
                      @click="pick(cell.iso, cell.disabled)"
                    >
                      {{ cell.date.getDate() }}
                      <span v-if="cell.iso === today && cell.iso !== model" class="absolute bottom-1 h-1 w-1 rounded-full bg-brand-500" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="mt-2 flex items-center justify-between border-t border-line pt-2">
              <button
                type="button"
                class="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 disabled:opacity-40 dark:text-brand-400 dark:hover:bg-brand-500/10"
                :disabled="(!!min && today < min) || (!!max && today > max)"
                @click="pick(today)"
              >
                Today
              </button>
              <button type="button" class="rounded-lg px-2 py-1 text-xs font-medium text-fg-muted transition hover:bg-surface-muted hover:text-fg" @click="clear(), close()">Clear</button>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>
  </AppFormField>
</template>
