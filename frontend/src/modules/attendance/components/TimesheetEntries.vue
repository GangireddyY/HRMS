<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ArrowRight, Clock3, Copy, Fingerprint, MessageSquarePlus, MessageSquareText, Plus, Tag, Trash2 } from '@lucide/vue';
import { TIMESHEET_ACTIVITY_MAX, TIMESHEET_MAX_ENTRIES, TIMESHEET_NOTE_MAX, TIMESHEET_PROJECT_MAX, rangeMinutes } from '@contracts';
import type { TimesheetDay } from '../types';
import { DAY_KIND_LABELS, dayParts, hoursLabel, parseHours, toHours } from '../utils/timesheet-format';

export interface EditableEntry {
  key: number;
  day: number;
  project: string;
  activity: string | null;
  start: string | null;
  end: string | null;
  minutes: number;
  note: string | null;
  noteOpen?: boolean;
}

/**
 * A week of work, day by day: each date lists its activities (project, activity, From → To, duration) with a note,
 * copy-to-next-day and remove actions, a timeline of the day and its total against the hours expected.
 */
const props = defineProps<{ days: TimesheetDay[]; readonly?: boolean; today?: string; suggestions?: { projects: string[]; activities: string[] } }>();
const entries = defineModel<EditableEntry[]>('entries', { required: true });

let nextKey = 100_000;
const uid = useId();

/** Suggestions under the Project / Activity field being typed in (names used before), keyboard friendly. */
type Field = 'project' | 'activity';
const suggest = ref<{ key: number; field: Field; index: number } | null>(null);
function options(e: EditableEntry, field: Field): string[] {
  const value = (field === 'project' ? e.project : (e.activity ?? '')).trim().toLowerCase();
  const pool = field === 'project' ? projects.value : activities.value;
  return pool.filter((p) => p.toLowerCase() !== value && (!value || p.toLowerCase().includes(value))).slice(0, 6);
}
const openFor = (e: EditableEntry, field: Field) => (suggest.value = { key: e.key, field, index: -1 });
const isOpen = (e: EditableEntry, field: Field) => suggest.value?.key === e.key && suggest.value.field === field && options(e, field).length > 0;
function pick(e: EditableEntry, field: Field, value: string) {
  if (field === 'project') e.project = value;
  else e.activity = value;
  suggest.value = null;
}
function onKey(event: KeyboardEvent, e: EditableEntry, field: Field) {
  const s = suggest.value;
  if (!s || s.key !== e.key || s.field !== field) return;
  const list = options(e, field);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    s.index = (s.index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
  } else if (event.key === 'Enter' && s.index >= 0 && list[s.index]) {
    event.preventDefault();
    pick(e, field, list[s.index]!);
  } else if (event.key === 'Escape') {
    suggest.value = null;
  }
}
const closeLater = () => setTimeout(() => (suggest.value = null), 120);

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** "4h 05m" (no leading zero on the hours). */
const short = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '0h');
const duration = (e: EditableEntry) => (e.start && e.end ? rangeMinutes(e.start, e.end) : e.minutes);
const forDay = (day: number) => entries.value.filter((e) => e.day === day);
const dayTotal = (day: number) => forDay(day).reduce((sum, e) => sum + duration(e), 0);
const weekTotal = computed(() => props.days.reduce((sum, _, i) => sum + dayTotal(i), 0));
const expectedTotal = computed(() => props.days.reduce((a, d) => a + d.expectedMinutes, 0));
const punchedTotal = computed(() => props.days.reduce((a, d) => a + (d.workedMinutes ?? 0), 0));

const projects = computed(() => [...new Set([...entries.value.map((e) => e.project.trim()), ...(props.suggestions?.projects ?? [])].filter(Boolean))]);
const activities = computed(() => [...new Set([...entries.value.map((e) => (e.activity ?? '').trim()), ...(props.suggestions?.activities ?? [])].filter(Boolean))]);

/** A steady colour per project name (same name, same colour), readable in light and dark mode. */
function projectColor(name: string): string {
  const key = name.trim().toLowerCase();
  if (!key) return 'var(--color-line)';
  let h = 7;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `oklch(0.66 0.15 ${(h % 12) * 30})`;
}

/** Keys of entries whose From–To overlaps another entry on the same day. */
const overlapping = computed(() => {
  const out = new Set<number>();
  for (let day = 0; day < 7; day++) {
    const timed = forDay(day).filter((e) => e.start && e.end);
    timed.forEach((a, i) =>
      timed.slice(i + 1).forEach((b) => {
        const [a0, b0] = [toMin(a.start!), toMin(b.start!)];
        if (a0 < b0 + duration(b) && b0 < a0 + duration(a)) out.add(a.key).add(b.key);
      }),
    );
  }
  return out;
});

/** The day as a strip from 06:00 to 22:00: the punched window and each timed activity. */
const DAY_FROM = 6 * 60;
const DAY_SPAN = 16 * 60;
const pct = (m: number) => `${Math.min(100, Math.max(0, ((m - DAY_FROM) / DAY_SPAN) * 100))}%`;
const width = (from: number, minutes: number) => `${Math.max(0.8, Math.min(100, ((Math.min(from + minutes, DAY_FROM + DAY_SPAN) - Math.max(from, DAY_FROM)) / DAY_SPAN) * 100))}%`;
function timeline(i: number) {
  const d = props.days[i]!;
  const segments = forDay(i)
    .filter((e) => e.start && e.end)
    .map((e) => ({ key: e.key, left: pct(toMin(e.start!)), width: width(toMin(e.start!), duration(e)), color: projectColor(e.project), label: `${e.project || 'Activity'} · ${e.start}–${e.end}` }));
  const punch = d.checkIn && d.checkOut ? { left: pct(toMin(d.checkIn)), width: width(toMin(d.checkIn), rangeMinutes(d.checkIn, d.checkOut)) } : null;
  return { segments, punch };
}

const locked = (d: TimesheetDay) => d.future || d.kind === 'NOT_EMPLOYED';
const offDay = (d: TimesheetDay) => d.kind !== 'WORKING';
const KIND_TAG: Record<string, { text: string; tone: string }> = {
  WEEKLY_OFF: { text: 'Weekly off', tone: 'bg-surface text-fg-subtle ring-line' },
  HOLIDAY: { text: 'Holiday', tone: 'bg-special-soft text-special-fg ring-special/20' },
  LEAVE: { text: 'Leave', tone: 'bg-warning-soft text-warning-fg ring-warning/25' },
  NOT_EMPLOYED: { text: 'Not employed', tone: 'bg-surface text-fg-subtle ring-line' },
};

function add(day: number) {
  if (entries.value.length >= TIMESHEET_MAX_ENTRIES) return;
  const d = props.days[day]!;
  const sameDay = forDay(day);
  const last = sameDay.at(-1) ?? [...entries.value].reverse().find((e) => e.day < day);
  const start = sameDay.at(-1)?.end ?? d.checkIn ?? '09:00';
  entries.value.push({ key: nextKey++, day, project: last?.project ?? '', activity: last?.activity ?? null, start, end: null, minutes: 0, note: null });
}
function copyToNextDay(e: EditableEntry) {
  const next = props.days.findIndex((d, i) => i > e.day && d.kind === 'WORKING' && !locked(d));
  const day = next === -1 ? e.day : next;
  let at = -1;
  entries.value.forEach((x, i) => x.day === day && (at = i));
  const copy = { ...e, key: nextKey++, day, noteOpen: false };
  if (at === -1) entries.value.push(copy);
  else entries.value.splice(at + 1, 0, copy);
}
function remove(e: EditableEntry) {
  entries.value = entries.value.filter((x) => x.key !== e.key);
}
function setTime(e: EditableEntry, which: 'start' | 'end', value: string) {
  e[which] = value || null;
  if (e.start && e.end) e.minutes = rangeMinutes(e.start, e.end);
}
/** The clock icon is hidden for a cleaner field; clicking the time opens the browser's picker instead. */
function openPicker(event: MouseEvent) {
  try {
    (event.target as HTMLInputElement).showPicker?.();
  } catch {
    // Some browsers refuse outside a trusted gesture; typing the time still works.
  }
}
function setMinutes(e: EditableEntry, value: string) {
  const m = parseHours(value);
  if (m !== null && m <= 1440) e.minutes = m;
}

/** Day total colour and how full the bar is against the hours expected. */
function dayState(i: number) {
  const d = props.days[i]!;
  const total = dayTotal(i);
  const expected = d.expectedMinutes;
  const fill = expected ? Math.min(100, Math.round((total / expected) * 100)) : total ? 100 : 0;
  if (total > 1440) return { text: 'text-danger-fg', bar: 'bg-danger', fill };
  if (expected && total >= expected) return { text: 'text-success-fg', bar: 'bg-success', fill };
  if (d.kind === 'WORKING' && !d.future && expected && total) return { text: 'text-warning-fg', bar: 'bg-warning', fill };
  return { text: total ? 'text-fg' : 'text-fg-subtle', bar: 'bg-brand-500', fill };
}

const bare = 'min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:[display:none!important]';
const longWeekday = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const timeInput = 'w-[4.6rem] bg-transparent text-center text-sm font-medium tabular-nums outline-none disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:hidden';
const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-subtle transition hover:bg-surface-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';
</script>

<template>
  <div class="text-sm">
    <section
      v-for="(d, i) in days"
      :key="d.date"
      :class="['grid gap-x-5 gap-y-3 border-b border-line/60 px-4 py-4 last:border-b-0 md:grid-cols-[10.5rem_minmax(0,1fr)_7rem]', offDay(d) && !forDay(i).length && 'bg-surface-muted/40']"
      :aria-label="`${dayParts(d.date).weekday} ${dayParts(d.date).day} ${dayParts(d.date).month}`"
    >
      <!-- Date -->
      <div class="flex items-start gap-3">
        <span
          :class="[
            'flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5 leading-none ring-1 ring-inset',
            d.date === today ? 'bg-brand-600 text-white ring-brand-600' : offDay(d) ? 'bg-surface-muted text-fg-muted ring-line/60' : 'bg-surface text-fg ring-line',
          ]"
          aria-hidden="true"
        >
          <span :class="['text-2xs font-semibold tracking-wide uppercase', d.date === today ? 'text-white/85' : 'text-fg-subtle']">{{ dayParts(d.date).weekday }}</span>
          <span class="mt-1 text-lg font-semibold tabular-nums">{{ dayParts(d.date).day }}</span>
        </span>
        <div class="min-w-0 flex-1 pt-0.5">
          <p class="flex flex-wrap items-center gap-1.5">
            <span :class="['text-sm font-semibold', offDay(d) ? 'text-fg-muted' : 'text-fg']">{{ d.date === today ? 'Today' : longWeekday(d.date) }}</span>
            <span v-if="KIND_TAG[d.kind]" :class="['rounded-full px-1.5 py-px text-2xs font-semibold ring-1 ring-inset', KIND_TAG[d.kind]!.tone]">{{ KIND_TAG[d.kind]!.text }}</span>
          </p>
          <p v-if="d.label" class="mt-0.5 truncate text-xs text-fg-subtle" :title="d.label">{{ d.label }}</p>
          <p v-if="d.checkIn" class="mt-1 inline-flex items-center gap-1 rounded-md bg-surface-muted/70 px-1.5 py-0.5 text-2xs text-fg-muted tabular-nums" title="Punched in attendance">
            <Fingerprint :size="11" aria-hidden="true" />{{ d.checkIn }} – {{ d.checkOut ?? '…' }}
          </p>
        </div>
        <div class="text-end md:hidden">
          <p :class="['text-sm font-semibold tabular-nums', dayState(i).text]">{{ short(dayTotal(i)) }}</p>
          <p v-if="d.expectedMinutes" class="text-2xs text-fg-subtle">of {{ hoursLabel(d.expectedMinutes) }}</p>
        </div>
      </div>

      <!-- Activities -->
      <div class="min-w-0 space-y-2">
        <div
          v-for="e in forDay(i)"
          :key="e.key"
          :class="[
            'group/entry rounded-xl bg-surface ring-1 transition',
            overlapping.has(e.key) ? 'ring-2 ring-danger/50' : 'ring-line/70 hover:shadow-xs hover:ring-line focus-within:ring-2 focus-within:ring-brand-500/40',
          ]"
        >
          <div class="flex flex-wrap items-center gap-1 p-1 md:flex-nowrap">
            <!-- Project -->
            <label :class="['relative flex h-9 min-w-0 flex-[1.3_1_12rem] items-center gap-2 rounded-lg px-2.5', !readonly && 'hover:bg-surface-muted/60', !e.project.trim() && duration(e) > 0 && 'bg-danger-soft/60']">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface" :style="{ background: projectColor(e.project) }" aria-hidden="true" />
              <span v-if="readonly" class="truncate font-medium text-fg" :title="e.project">{{ e.project }}</span>
              <input
                v-else
                v-model="e.project"
                :class="[bare, 'font-medium text-fg']"
                placeholder="Project"
                autocomplete="off"
                role="combobox"
                :aria-expanded="isOpen(e, 'project')"
                :aria-controls="`${uid}-${e.key}-project`"
                :maxlength="TIMESHEET_PROJECT_MAX"
                :disabled="locked(d)"
                :aria-label="`${dayParts(d.date).weekday} ${dayParts(d.date).day}: project`"
                @focus="openFor(e, 'project')"
                @input="openFor(e, 'project')"
                @keydown="onKey($event, e, 'project')"
                @blur="closeLater"
              />
              <ul v-if="isOpen(e, 'project')" :id="`${uid}-${e.key}-project`" role="listbox" class="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg bg-surface py-1 shadow-pop ring-1 ring-line">
                <li
                  v-for="(o, n) in options(e, 'project')"
                  :key="o"
                  role="option"
                  :aria-selected="suggest?.index === n"
                  :class="['flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm', suggest?.index === n ? 'bg-accent-soft text-accent-fg' : 'text-fg hover:bg-surface-muted']"
                  @mousedown.prevent="pick(e, 'project', o)"
                >
                  <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: projectColor(o) }" aria-hidden="true" />{{ o }}
                </li>
              </ul>
            </label>
            <span class="hidden h-5 w-px bg-line md:block" aria-hidden="true" />
            <!-- Activity -->
            <label :class="['relative flex h-9 min-w-0 flex-[1_1_9rem] items-center gap-2 rounded-lg px-2.5', !readonly && 'hover:bg-surface-muted/60']">
              <Tag :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
              <span v-if="readonly" class="truncate text-fg-muted" :title="e.activity ?? ''">{{ e.activity ?? '—' }}</span>
              <input
                v-else
                :value="e.activity ?? ''"
                :class="[bare, 'text-fg']"
                placeholder="Activity"
                autocomplete="off"
                role="combobox"
                :aria-expanded="isOpen(e, 'activity')"
                :aria-controls="`${uid}-${e.key}-activity`"
                :maxlength="TIMESHEET_ACTIVITY_MAX"
                :disabled="locked(d)"
                :aria-label="`${dayParts(d.date).weekday} ${dayParts(d.date).day}: activity`"
                @focus="openFor(e, 'activity')"
                @input="(e.activity = ($event.target as HTMLInputElement).value || null), openFor(e, 'activity')"
                @keydown="onKey($event, e, 'activity')"
                @blur="closeLater"
              />
              <ul v-if="isOpen(e, 'activity')" :id="`${uid}-${e.key}-activity`" role="listbox" class="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg bg-surface py-1 shadow-pop ring-1 ring-line">
                <li
                  v-for="(o, n) in options(e, 'activity')"
                  :key="o"
                  role="option"
                  :aria-selected="suggest?.index === n"
                  :class="['flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm', suggest?.index === n ? 'bg-accent-soft text-accent-fg' : 'text-fg hover:bg-surface-muted']"
                  @mousedown.prevent="pick(e, 'activity', o)"
                >
                  <Tag :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" />{{ o }}
                </li>
              </ul>
            </label>

            <div class="flex flex-1 flex-wrap items-center justify-end gap-1 max-md:justify-start md:flex-none md:flex-nowrap">
              <!-- From → To -->
              <div
                :class="[
                  'flex h-9 items-center gap-1 rounded-lg px-2 ring-1 ring-inset',
                  e.start && !e.end ? 'bg-warning-soft/60 ring-warning/40' : 'bg-surface-muted/70 ring-line/50',
                ]"
              >
                <Clock3 :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
                <template v-if="readonly">
                  <span class="w-[3.4rem] text-center font-medium text-fg tabular-nums">{{ e.start ?? '—' }}</span>
                  <ArrowRight :size="12" class="text-fg-subtle" aria-hidden="true" />
                  <span class="w-[3.4rem] text-center font-medium text-fg tabular-nums">{{ e.end ?? '—' }}</span>
                </template>
                <template v-else>
                  <input
                    :value="e.start ?? ''"
                    type="time"
                    :class="timeInput"
                    :disabled="locked(d)"
                    :aria-label="`${dayParts(d.date).weekday} ${dayParts(d.date).day}: from`"
                    @click="openPicker"
                    @input="setTime(e, 'start', ($event.target as HTMLInputElement).value)"
                  />
                  <ArrowRight :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" />
                  <input
                    :value="e.end ?? ''"
                    type="time"
                    :class="timeInput"
                    :disabled="locked(d)"
                    :aria-label="`${dayParts(d.date).weekday} ${dayParts(d.date).day}: to`"
                    @click="openPicker"
                    @input="setTime(e, 'end', ($event.target as HTMLInputElement).value)"
                  />
                </template>
              </div>

              <!-- Duration -->
              <span
                v-if="e.start && e.end"
                class="inline-flex h-7 min-w-[4.75rem] items-center justify-center rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent-fg tabular-nums"
                :title="e.end <= e.start ? 'Runs past midnight' : 'Duration'"
              >
                {{ short(duration(e)) }}
              </span>
              <label v-else-if="!e.start && !readonly" class="inline-flex h-7 min-w-[4.75rem] items-center gap-1 rounded-full bg-surface-muted px-2.5 ring-1 ring-line/60 ring-inset" title="No times? Enter the hours, e.g. 7.5 or 7:30">
                <input :value="toHours(e.minutes)" class="w-9 bg-transparent text-center text-xs font-semibold tabular-nums outline-none" inputmode="decimal" placeholder="0" :disabled="locked(d)" aria-label="Hours" @change="setMinutes(e, ($event.target as HTMLInputElement).value)" />
                <span class="text-2xs text-fg-subtle">hrs</span>
              </label>
              <span v-else-if="!e.start" class="inline-flex h-7 min-w-[4.75rem] items-center justify-center rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent-fg tabular-nums">{{ short(duration(e)) }}</span>
              <span v-else class="inline-flex h-7 min-w-[4.75rem] items-center justify-center rounded-full bg-warning-soft px-2.5 text-2xs font-semibold text-warning-fg">Add end</span>

              <!-- Actions -->
              <span v-if="!readonly" class="flex items-center opacity-100 transition-opacity max-md:ms-auto md:opacity-0 md:group-hover/entry:opacity-100 md:group-focus-within/entry:opacity-100 [@media(hover:none)]:opacity-100">
                <button
                  type="button"
                  :class="[iconButton, (e.note || e.noteOpen) && 'text-accent-fg md:opacity-100']"
                  :aria-label="e.note ? 'Edit note' : 'Add a note'"
                  :title="e.note ? 'Edit note' : 'Add a note'"
                  :disabled="locked(d)"
                  @click="e.noteOpen = !e.noteOpen"
                >
                  <MessageSquareText v-if="e.note" :size="15" />
                  <MessageSquarePlus v-else :size="15" />
                </button>
                <button type="button" :class="iconButton" aria-label="Copy to the next working day" title="Copy to the next working day" :disabled="locked(d)" @click="copyToNextDay(e)">
                  <Copy :size="14" />
                </button>
                <button type="button" :class="[iconButton, 'hover:bg-danger-soft hover:text-danger-fg']" aria-label="Remove activity" title="Remove" :disabled="locked(d)" @click="remove(e)">
                  <Trash2 :size="14" />
                </button>
              </span>
              <MessageSquareText v-else-if="e.note" :size="14" class="mx-2 text-fg-subtle" :aria-label="`Note: ${e.note}`" />
            </div>
          </div>

          <!-- Note -->
          <div v-if="readonly ? e.note : e.noteOpen || e.note" class="flex items-center gap-2 border-t border-line/50 px-3.5 py-2">
            <MessageSquareText :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
            <p v-if="readonly" class="text-xs text-fg-muted">{{ e.note }}</p>
            <input
              v-else
              :value="e.note ?? ''"
              :class="[bare, 'text-xs text-fg-muted']"
              placeholder="Note for your reviewer (optional)"
              :maxlength="TIMESHEET_NOTE_MAX"
              :disabled="locked(d)"
              aria-label="Note"
              @input="e.note = ($event.target as HTMLInputElement).value || null"
            />
          </div>
        </div>

        <p v-if="forDay(i).some((e) => overlapping.has(e.key))" class="text-xs font-medium text-danger-fg">Some of these times overlap.</p>

        <!-- Timeline of the day -->
        <div v-if="timeline(i).segments.length" class="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`Day from 06:00 to 22:00: ${timeline(i).segments.map((s) => s.label).join(', ')}`">
          <span v-if="timeline(i).punch" class="absolute inset-y-0 rounded-full bg-fg/10" :style="{ left: timeline(i).punch!.left, width: timeline(i).punch!.width }" />
          <span v-for="s in timeline(i).segments" :key="s.key" class="absolute inset-y-0 rounded-full" :style="{ left: s.left, width: s.width, background: s.color }" :title="s.label" />
        </div>

        <button
          v-if="!readonly && !locked(d)"
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-line px-3 text-xs font-medium text-fg-muted transition hover:border-brand-400 hover:bg-accent-soft/50 hover:text-accent-fg disabled:opacity-50"
          :disabled="entries.length >= TIMESHEET_MAX_ENTRIES"
          @click="add(i)"
        >
          <Plus :size="13" aria-hidden="true" />Add activity
        </button>
        <p v-else-if="!forDay(i).length" class="flex h-8 items-center text-xs text-fg-subtle">{{ d.future ? 'Upcoming' : readonly ? 'Nothing logged' : DAY_KIND_LABELS[d.kind] }}</p>
      </div>

      <!-- Day total -->
      <div class="hidden pt-1 text-end md:block">
        <p :class="['text-base font-semibold tabular-nums', dayState(i).text]">{{ dayTotal(i) ? short(dayTotal(i)) : '—' }}</p>
        <p v-if="d.expectedMinutes" class="text-2xs text-fg-subtle tabular-nums">of {{ hoursLabel(d.expectedMinutes) }}</p>
        <div v-if="d.expectedMinutes || dayTotal(i)" class="ms-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
          <div :class="['h-full rounded-full transition-[width] duration-500', dayState(i).bar]" :style="{ width: `${dayState(i).fill}%` }" />
        </div>
      </div>
    </section>

    <!-- Week total -->
    <div class="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-line bg-surface-muted/50 px-4 py-3">
      <p v-if="punchedTotal" class="inline-flex items-center gap-1.5 text-xs text-fg-subtle"><Fingerprint :size="13" aria-hidden="true" />Punched <span class="font-medium text-fg-muted tabular-nums">{{ hoursLabel(punchedTotal) }}</span></p>
      <p v-if="expectedTotal" class="text-xs text-fg-subtle">Expected <span class="font-medium text-fg-muted tabular-nums">{{ hoursLabel(expectedTotal) }}</span></p>
      <p class="text-sm text-fg-muted">Week total <span class="ms-1 text-base font-bold text-fg tabular-nums">{{ short(weekTotal) }}</span></p>
    </div>
  </div>
</template>
