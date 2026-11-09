<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CalendarCheck2, Download } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { HOLIDAY_COUNTRIES, type HolidayCountry, type OfficialHolidayKind } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { OfficialHoliday, OfficialHolidays } from '@/modules/attendance/types';
import { WEEKDAY_SHORT } from '@/modules/attendance/utils/attendance-format';
import { AppAlert, AppBadge, AppButton, AppEmptyState, AppErrorState, AppModal, AppSegmented, AppSelect, AppSkeleton, AppSwitch } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Pick which of a country's official holidays the organization gives, as days off or optional holidays. */
const props = defineProps<{ open: boolean; year: number }>();
const emit = defineEmits<{ close: []; imported: [year: number] }>();
const feedback = useFeedbackStore();

const country = ref<HolidayCountry | undefined>(undefined);
const year = ref(props.year);
const data = ref<OfficialHolidays | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);
const importing = ref(false);
const showObservances = ref(false);
/** Chosen holidays by row key, and whether each is optional. */
const chosen = reactive(new Map<string, boolean>());

const countryOptions = (Object.entries(HOLIDAY_COUNTRIES) as [HolidayCountry, string][]).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
const yearOptions = computed(() => [props.year - 1, props.year, props.year + 1].map((y) => ({ value: y, label: String(y) })));
const typeOptions = [
  { value: 'off' as const, label: 'Day off' },
  { value: 'optional' as const, label: 'Optional' },
];
const KIND: Record<OfficialHolidayKind, { label: string; tone: 'violet' | 'info' | 'neutral' }> = {
  PUBLIC: { label: 'Public holiday', tone: 'violet' },
  REGIONAL: { label: 'Regional', tone: 'info' },
  OBSERVANCE: { label: 'Observance', tone: 'neutral' },
};

const keyOf = (h: OfficialHoliday) => `${h.date}|${h.name}`;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const monthLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(appLocale(), { month: 'long', timeZone: 'UTC' });

let sequence = 0;
async function load() {
  const current = ++sequence;
  loading.value = true;
  error.value = null;
  try {
    const result = await attendanceApi.officialHolidays(year.value, country.value);
    if (current !== sequence) return;
    data.value = result;
    country.value = result.country;
    chosen.clear();
    // National public holidays are what most organizations give; everything else is picked by hand.
    for (const h of result.holidays) if (h.kind === 'PUBLIC' && !h.existing) chosen.set(keyOf(h), false);
  } catch (e) {
    if (current !== sequence) return;
    error.value = e;
    data.value = null;
  } finally {
    if (current === sequence) loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    data.value = null;
    year.value = props.year;
    showObservances.value = false;
    void load();
  },
);
watch([country, year], ([c, y]) => {
  if (props.open && !loading.value && (c !== data.value?.country || y !== data.value?.year)) void load();
});

const visible = computed(() => (data.value?.holidays ?? []).filter((h) => showObservances.value || h.kind !== 'OBSERVANCE' || chosen.has(keyOf(h))));
const byMonth = computed(() => {
  const groups: { month: string; label: string; items: OfficialHoliday[] }[] = [];
  for (const h of visible.value) {
    const month = h.date.slice(0, 7);
    if (groups.at(-1)?.month !== month) groups.push({ month, label: monthLabel(h.date), items: [] });
    groups.at(-1)!.items.push(h);
  }
  return groups;
});
const observanceCount = computed(() => (data.value?.holidays ?? []).filter((h) => h.kind === 'OBSERVANCE').length);
const picked = computed(() => (data.value?.holidays ?? []).filter((h) => chosen.has(keyOf(h))));
const daysOff = computed(() => new Set(picked.value.filter((h) => !chosen.get(keyOf(h))).map((h) => h.date)).size);
const optional = computed(() => new Set(picked.value.map((h) => h.date)).size - daysOff.value);

function toggle(h: OfficialHoliday, on: boolean) {
  if (on) chosen.set(keyOf(h), h.kind !== 'PUBLIC');
  else chosen.delete(keyOf(h));
}
function selectPublic() {
  for (const h of data.value?.holidays ?? []) if (h.kind === 'PUBLIC' && !h.existing && !chosen.has(keyOf(h))) chosen.set(keyOf(h), false);
}

/** One holiday per date: holidays chosen on the same day are combined ("Independence Day / Parsi New Year"). */
function payload() {
  const byDate = new Map<string, { names: string[]; optional: boolean }>();
  for (const h of picked.value) {
    const entry = byDate.get(h.date) ?? { names: [], optional: true };
    entry.names.push(h.name);
    entry.optional &&= chosen.get(keyOf(h)) ?? false;
    byDate.set(h.date, entry);
  }
  return [...byDate].map(([date, e]) => ({ date, name: e.names.join(' / ').slice(0, 120), isOptional: e.optional }));
}

async function importSelected() {
  const holidays = payload();
  if (!holidays.length) return;
  importing.value = true;
  try {
    const result = await attendanceApi.importHolidays({ country: country.value, holidays });
    feedback.success(
      `${result.created} holiday${result.created === 1 ? '' : 's'} added`,
      result.skipped ? `${result.skipped} date${result.skipped === 1 ? ' already had' : 's already had'} a holiday and ${result.skipped === 1 ? 'was' : 'were'} left as is.` : undefined,
    );
    emit('imported', year.value);
  } catch (e) {
    feedback.error('Could not import holidays', e);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <AppModal
    :open="open"
    title="Import official holidays"
    description="Start from the country's official holiday list and choose the ones your organization gives."
    size="xl"
    :guide="false"
    :guard-changes="false"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-[1fr_140px]">
        <AppSelect v-model="country" :options="countryOptions" label="Country" :clearable="false" :disabled="loading" />
        <AppSelect v-model="year" :options="yearOptions" label="Year" :clearable="false" :searchable="false" :disabled="loading" />
      </div>

      <AppAlert v-if="data" tone="info">
        Dates come from the public holiday calendar for {{ data.countryName }}. Moon-based festivals can be marked <em>tentative</em> and may move by a day once the government notifies the final date, so review them before the year starts.
      </AppAlert>

      <AppSkeleton v-if="loading && !data" :lines="8" />
      <AppErrorState v-else-if="error" :error="error" @retry="load" />
      <template v-else-if="data">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <AppButton size="sm" variant="secondary" :icon="CalendarCheck2" @click="selectPublic">Select all public holidays</AppButton>
            <AppButton size="sm" variant="ghost" :disabled="!chosen.size" @click="chosen.clear()">Clear selection</AppButton>
          </div>
          <AppSwitch v-if="observanceCount" v-model="showObservances" class="sm:w-80" :label="`Show observances (${observanceCount})`" description="Festivals and days that aren't official days off." />
        </div>

        <AppEmptyState v-if="!visible.length" compact title="No official holidays listed" :description="`The calendar has no holidays for ${data.year} yet. Try another year.`" />
        <div v-else :class="['divide-y divide-line/70 overflow-hidden rounded-md border border-line', loading && 'opacity-60']">
          <section v-for="g in byMonth" :key="g.month" :aria-label="g.label">
            <h3 class="bg-surface-muted/70 px-4 py-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">{{ g.label }}</h3>
            <ul class="divide-y divide-line/50">
              <li v-for="h in g.items" :key="keyOf(h)" :class="['flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5', chosen.has(keyOf(h)) && 'bg-accent-soft/40']">
                <label :class="['flex min-w-0 flex-1 items-center gap-3', h.existing ? 'cursor-not-allowed' : 'cursor-pointer']">
                  <input
                    type="checkbox"
                    class="h-4 w-4 shrink-0 cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                    :checked="chosen.has(keyOf(h))"
                    :disabled="!!h.existing"
                    @change="toggle(h, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="w-24 shrink-0 text-sm tabular-nums">
                    <span class="font-medium text-fg">{{ formatDate(h.date) }}</span>
                    <span :class="['block text-xs', weekday(h.date) === 0 || weekday(h.date) === 6 ? 'font-medium text-warning-fg' : 'text-fg-muted']">{{ WEEKDAY_SHORT[weekday(h.date)] }}</span>
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-fg">{{ h.name }}</span>
                    <span class="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <AppBadge size="sm" :tone="KIND[h.kind].tone">{{ KIND[h.kind].label }}</AppBadge>
                      <AppBadge v-if="h.halfDay" size="sm" tone="warning">Half day</AppBadge>
                      <AppBadge v-if="weekday(h.date) === 0 || weekday(h.date) === 6" size="sm" tone="warning">Falls on a weekend</AppBadge>
                      <span v-if="h.regions.length" class="max-w-xs truncate text-xs text-fg-muted" :title="h.regions.join(', ')">{{ h.regions.join(', ') }}</span>
                      <span v-if="h.existing" class="text-xs text-fg-muted">Already in your calendar as “{{ h.existing }}”</span>
                    </span>
                  </span>
                </label>
                <AppSegmented
                  v-if="chosen.has(keyOf(h))"
                  :model-value="chosen.get(keyOf(h)) ? 'optional' : 'off'"
                  class="w-44 max-sm:ms-7 max-sm:w-auto"
                  size="sm"
                  :options="typeOptions"
                  :label="`How ${h.name} is given`"
                  @update:model-value="(v: 'off' | 'optional') => chosen.set(keyOf(h), v === 'optional')"
                />
              </li>
            </ul>
          </section>
        </div>
      </template>
    </div>

    <template #footer>
      <p class="me-auto text-sm text-fg-muted" aria-live="polite">
        <template v-if="daysOff + optional">{{ daysOff }} day{{ daysOff === 1 ? '' : 's' }} off · {{ optional }} optional</template>
        <template v-else>Nothing selected</template>
      </p>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :icon="Download" :loading="importing" :disabled="!(daysOff + optional) || loading" @click="importSelected">Add to holidays</AppButton>
    </template>
  </AppModal>
</template>
