<script setup lang="ts">
import { computed, ref } from 'vue';
import { AppButton, AppSegmented, AppSelect } from '@/shared/components';
import { saveLocaleToAccount } from '@/core/theme/appearance-sync';
import { applyLocale, readLocalePrefs, REGIONS, resolveDirection, saveLocalePrefs, type Direction, type HourCycle, type LocalePrefs, type Region } from '../locale';

const saved = readLocalePrefs();
const form = ref<LocalePrefs>({ ...saved });
const dirty = computed(() => form.value.region !== saved.region || form.value.hourCycle !== saved.hourCycle || form.value.direction !== saved.direction);

const regionOptions = REGIONS.map((r) => ({ value: r.key as Region, label: r.label }));
const clockOptions: { value: HourCycle; label: string }[] = [
  { value: 'auto', label: 'Region' },
  { value: 'h12', label: '12-hour' },
  { value: 'h23', label: '24-hour' },
];
const directionOptions: { value: Direction; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'ltr', label: 'Left to right' },
  { value: 'rtl', label: 'Right to left' },
];

/** Live sample in the chosen formats, before saving. */
const sample = computed(() => {
  const p = form.value;
  let tag = p.region === 'auto' ? navigator.language || 'en-IN' : p.region;
  if (p.hourCycle !== 'auto') tag = `${tag}-u-hc-${p.hourCycle}`;
  const at = new Date(Date.UTC(2026, 10, 24, 14, 30));
  return {
    date: new Intl.DateTimeFormat(tag, { dateStyle: 'full', timeZone: 'UTC' }).format(at),
    short: new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: 'UTC' }).format(at),
    time: new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(at),
    number: new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(1234567.89),
    money: new Intl.NumberFormat(tag, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(1250000),
    direction: resolveDirection(p),
  };
});

async function apply() {
  saveLocalePrefs(form.value);
  applyLocale(document.documentElement, form.value);
  await saveLocaleToAccount(form.value);
  // Formatters are created once per module, so a reload picks up the new formats everywhere.
  window.location.reload();
}
</script>

<template>
  <div class="space-y-5">
    <AppSelect v-model="form.region" label="Region formats" :options="regionOptions" help="Dates, times, numbers and currency follow this region. Interface text stays in English." class="max-w-md" />
    <div>
      <p class="label">Clock</p>
      <AppSegmented v-model="form.hourCycle" :options="clockOptions" label="Clock" class="w-full max-w-md" />
    </div>
    <div>
      <p class="label">Layout direction</p>
      <AppSegmented v-model="form.direction" :options="directionOptions" label="Layout direction" class="w-full max-w-md" />
      <p class="help-text">Automatic mirrors the layout for right-to-left regions such as Arabic.</p>
    </div>

    <dl class="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-md border border-line bg-surface-muted/50 px-4 py-3 text-sm" aria-label="Preview">
      <dt class="text-fg-muted">Date</dt>
      <dd class="text-fg">{{ sample.date }}</dd>
      <dt class="text-fg-muted">Short date</dt>
      <dd class="text-fg tabular-nums">{{ sample.short }}</dd>
      <dt class="text-fg-muted">Time</dt>
      <dd class="text-fg tabular-nums">{{ sample.time }}</dd>
      <dt class="text-fg-muted">Number</dt>
      <dd class="text-fg tabular-nums">{{ sample.number }}</dd>
      <dt class="text-fg-muted">Salary</dt>
      <dd class="text-fg tabular-nums">{{ sample.money }}</dd>
      <dt class="text-fg-muted">Direction</dt>
      <dd class="text-fg">{{ sample.direction === 'rtl' ? 'Right to left' : 'Left to right' }}</dd>
    </dl>

    <div class="flex items-center gap-3">
      <AppButton :disabled="!dirty" @click="apply">Apply</AppButton>
      <p v-if="dirty" class="text-xs text-fg-muted">The page reloads to apply the new formats.</p>
    </div>
  </div>
</template>
