<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { AlertTriangle, CalendarDays } from '@lucide/vue';
import type { LeaveSession } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { Balance, LeaveQuote, LeaveType } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Apply for leave with a live preview of the days counted, the balance left and any rule the request breaks. */
const props = defineProps<{ open: boolean; balances: Balance[]; types: LeaveType[]; initialTypeId?: string | null }>();
const emit = defineEmits<{ close: []; applied: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const quote = ref<LeaveQuote | null>(null);
const quoting = ref(false);
const form = reactive({
  leaveTypeId: null as string | null,
  startDate: undefined as string | undefined,
  endDate: undefined as string | undefined,
  singleSession: 'FULL' as LeaveSession,
  startAfternoon: false,
  endMorning: false,
  reason: '',
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    quote.value = null;
    Object.assign(form, { leaveTypeId: props.initialTypeId ?? null, startDate: undefined, endDate: undefined, singleSession: 'FULL', startAfternoon: false, endMorning: false, reason: '' });
  },
  { immediate: true },
);

const byType = computed(() => new Map(props.balances.map((b) => [b.leaveType.id, b])));
const typeOptions = computed(() =>
  props.types
    .filter((t) => t.isActive && byType.value.has(t.id))
    .map((t) => {
      const b = byType.value.get(t.id)!;
      return { value: t.id, label: `${t.name} (${t.code})`, description: b.available === null ? 'No limit' : `${formatDays(b.available)} available` };
    }),
);
const pickable = computed(() => props.balances.filter((b) => typeOptions.value.some((o) => o.value === b.leaveType.id)));
const type = computed(() => props.types.find((t) => t.id === form.leaveTypeId) ?? null);
const singleDay = computed(() => !!form.startDate && (!form.endDate || form.endDate === form.startDate));
const sessionOptions = [
  { value: 'FULL' as const, label: 'Full day' },
  { value: 'FIRST_HALF' as const, label: 'First half (morning)' },
  { value: 'SECOND_HALF' as const, label: 'Second half (afternoon)' },
];

// Keep the end date on or after the start date.
watch(
  () => form.startDate,
  (s) => {
    if (s && (!form.endDate || form.endDate < s)) form.endDate = s;
  },
);

function body() {
  const startSession: LeaveSession = singleDay.value ? form.singleSession : form.startAfternoon ? 'SECOND_HALF' : 'FULL';
  const endSession: LeaveSession = singleDay.value ? form.singleSession : form.endMorning ? 'FIRST_HALF' : 'FULL';
  return { leaveTypeId: form.leaveTypeId!, startDate: form.startDate!, endDate: form.endDate ?? form.startDate!, startSession, endSession };
}

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
watch(
  () => [form.leaveTypeId, form.startDate, form.endDate, form.singleSession, form.startAfternoon, form.endMorning],
  () => {
    clearTimeout(timer);
    if (!form.leaveTypeId || !form.startDate) {
      quote.value = null;
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      quoting.value = true;
      try {
        const q = await leaveApi.quote(body());
        if (mine === seq) quote.value = q;
      } catch (e) {
        if (mine === seq) {
          quote.value = null;
          handle(e, 'Could not check these dates');
        }
      } finally {
        if (mine === seq) quoting.value = false;
      }
    }, 250);
  },
);

const skipped = computed(() => {
  const b = quote.value?.breakdown ?? [];
  return { weeklyOffs: b.filter((d) => d.skipped === 'WEEKLY_OFF').length, holidays: b.filter((d) => d.skipped === 'HOLIDAY').length };
});
const canSubmit = computed(() => !!quote.value && !quote.value.issues.length && quote.value.days > 0 && form.reason.trim().length >= 3 && !quoting.value);

async function submit() {
  reset();
  saving.value = true;
  try {
    await leaveApi.apply({ ...body(), reason: form.reason });
    emit('applied');
  } catch (e) {
    handle(e, 'Could not submit your leave request');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Apply for leave" description="Your manager is notified and can approve or reject the request." size="lg" @close="emit('close')">
    <form id="apply-leave-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSelect v-model="form.leaveTypeId" label="Leave type" required :options="typeOptions" placeholder="Choose a leave type" :clearable="false" :error="fieldErrors.leaveTypeId" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="form.startDate" label="From" required :error="fieldErrors.startDate" />
        <AppDatePicker v-model="form.endDate" label="To" required :min="form.startDate" :error="fieldErrors.endDate" />
      </div>
      <template v-if="type?.allowHalfDay && form.startDate">
        <AppSelect v-if="singleDay" v-model="form.singleSession" label="Duration" :options="sessionOptions" :clearable="false" />
        <div v-else class="flex flex-wrap gap-x-4 gap-y-2">
          <AppCheckbox v-model="form.startAfternoon" label="Start from the afternoon" />
          <AppCheckbox v-model="form.endMorning" label="End at noon on the last day" />
        </div>
      </template>

      <div v-if="quote || quoting" class="rounded-md border border-line bg-ai-wash p-4 text-sm" aria-live="polite">
        <div v-if="quote" class="flex flex-wrap items-baseline justify-between gap-3">
          <p class="flex items-center gap-2 font-medium text-fg">
            <CalendarDays :size="16" class="text-fg-muted" aria-hidden="true" />
            {{ formatDays(quote.days) }} of leave
          </p>
          <p v-if="quote.available !== null" class="text-fg-muted">
            {{ formatDays(quote.available) }} available → <span :class="(quote.remainingAfter ?? 0) < 0 ? 'font-medium text-red-600 dark:text-red-400' : 'font-medium text-fg'">{{ formatDays(quote.remainingAfter) }} left</span>
          </p>
          <p v-else class="text-fg-muted">No balance limit</p>
        </div>
        <p v-else class="text-fg-muted">Checking…</p>
        <p v-if="quote && (skipped.weeklyOffs || skipped.holidays)" class="mt-1 text-xs text-fg-muted">
          Not counted: {{ [skipped.weeklyOffs && `${skipped.weeklyOffs} weekly off${skipped.weeklyOffs === 1 ? '' : 's'}`, skipped.holidays && `${skipped.holidays} holiday${skipped.holidays === 1 ? '' : 's'}`].filter(Boolean).join(' and ') }}.
        </p>
        <ul v-if="quote?.issues.length" class="mt-3 space-y-1.5">
          <li v-for="(i, n) in quote.issues" :key="n" class="flex items-start gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />{{ i.message }}
          </li>
        </ul>
      </div>

      <AppTextarea v-model="form.reason" label="Reason" required :rows="3" :maxlength="500" placeholder="e.g. Family function" :error="fieldErrors.reason" />
    </form>
    <template #aside>
      <section v-if="pickable.length" class="card">
        <h3 class="border-b border-line/70 px-4 py-2.5 text-sm font-semibold text-fg">Your balances</h3>
        <ul class="p-1.5">
          <li v-for="b in pickable" :key="b.leaveType.id">
            <button
              type="button"
              :class="['flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition', form.leaveTypeId === b.leaveType.id ? 'bg-brand-50 ring-1 ring-brand-300 dark:bg-brand-500/10 dark:ring-brand-500/40' : 'hover:bg-surface-muted']"
              :aria-pressed="form.leaveTypeId === b.leaveType.id"
              @click="form.leaveTypeId = b.leaveType.id"
            >
              <span class="h-6 w-1 shrink-0 rounded-full" :style="{ background: b.leaveType.color }" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-fg">{{ b.leaveType.name }}</span>
              <span class="font-semibold text-fg tabular-nums">{{ b.available === null ? '∞' : formatDays(b.available) }}</span>
            </button>
          </li>
        </ul>
        <p class="border-t border-line/70 px-4 py-2 text-xs text-fg-muted">Available after pending requests. Pick one to apply for it.</p>
      </section>
    </template>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="apply-leave-form" :loading="saving" :disabled="!canSubmit">Submit request</AppButton>
    </template>
  </AppModal>
</template>
