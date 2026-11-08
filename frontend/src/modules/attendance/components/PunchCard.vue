<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Clock, House, LogIn, LogOut, MapPin } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import DayTrack from '@/modules/attendance/components/DayTrack.vue';
import WeekHoursChart from '@/modules/attendance/components/WeekHoursChart.vue';
import type { CalendarDay } from '@/modules/attendance/types';
import { DAY_STATUS_LABELS, addDays, dayStatusTone, formatMinutes, formatTime } from '@/modules/attendance/utils/attendance-format';
import { AppBadge, AppButton, AppEmptyState, AppErrorState, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const emit = defineEmits<{ changed: [] }>();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const today = useAsync(() => attendanceApi.today());
const busy = ref(false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)));
onBeforeUnmount(() => clearInterval(timer));

const data = computed(() => today.data.value);
const tz = computed(() => data.value?.timeZone);
const open = computed(() => data.value?.openRecord ?? null);
const done = computed(() => (!open.value && data.value?.record?.checkOutAt ? data.value.record : null));
const canPunch = computed(() => auth.can('attendance.mark') && !data.value?.periodClosed && data.value?.employee?.status !== 'EXITED');
const target = computed(() => data.value?.shift?.fullDayMinutes || 480);
const dayOff = computed(() => !!data.value && (!!data.value.isWeeklyOff || (!!data.value.holiday && !data.value.holiday.isOptional)));
const nowLabel = computed(() => new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz.value }).format(new Date(now.value)).replace(/,? (\d{2}:\d{2})$/, ' · $1'));
const workedSoFar = computed(() => (open.value?.checkInAt ? Math.max(0, Math.floor((now.value - new Date(open.value.checkInAt).getTime()) / 60_000)) : 0));
const worked = computed(() => (open.value ? workedSoFar.value : (done.value?.workedMinutes ?? 0)));

function minutesOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz.value }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
}
const hm = (s: string) => {
  const [h = 0, m = 0] = s.split(':').map(Number);
  return h * 60 + m;
};

const track = computed(() => {
  const s = data.value?.shift;
  if (!s) return null;
  const start = hm(s.startTime);
  const nowM = minutesOfDay(now.value);
  return { start: s.startTime, started: nowM > start + (s.graceMinutes ?? 0) && nowM - start < 720 };
});

const showTrack = computed(() => !!data.value?.shift && (!!open.value || !!done.value || !dayOff.value));

type Tone = 'live' | 'done' | 'violet' | 'warning' | 'neutral';
const status = computed<{ label: string; detail?: string; tone: Tone }>(() => {
  const d = data.value!;
  if (open.value) return { label: 'Working', detail: `since ${formatTime(open.value.checkInAt, tz.value)}`, tone: 'live' };
  if (done.value) return { label: 'Day complete', detail: `${formatTime(done.value.checkInAt, tz.value)}–${formatTime(done.value.checkOutAt, tz.value)}`, tone: 'done' };
  if (d.holiday && !d.holiday.isOptional) return { label: 'Holiday', detail: d.holiday.name, tone: 'violet' };
  if (d.isWeeklyOff) return { label: d.rostered ? 'Day off' : 'Weekly off', tone: 'neutral' };
  if (d.holiday) return { label: 'Optional holiday', detail: d.holiday.name, tone: 'violet' };
  return track.value?.started ? { label: 'Not punched in', detail: `shift started ${track.value.start}`, tone: 'warning' } : { label: 'Not punched in yet', detail: track.value ? `shift starts ${track.value.start}` : undefined, tone: 'neutral' };
});
const dotClass: Record<Tone, string> = { live: 'bg-success', done: 'bg-brand-500', violet: 'bg-special', warning: 'bg-warning', neutral: 'bg-fg-subtle' };

const subline = computed(() => {
  const day = formatMinutes(target.value).replace(/ 00m$/, '');
  if (open.value) return worked.value < target.value ? `${formatMinutes(target.value - worked.value)} to go · full day ${day}` : `Full day done · ${formatMinutes(worked.value - target.value)} over`;
  if (done.value) return `Full day ${day}`;
  return dayOff.value ? 'Enjoy your day off.' : `Full day ${day}`;
});

const week = ref<CalendarDay[]>([]);
const weekLoading = ref(false);
async function loadWeek() {
  const end = data.value?.date;
  if (!end || !data.value?.employee) return;
  const start = addDays(end, -6);
  const months = [...new Set([start.slice(0, 7), end.slice(0, 7)])];
  weekLoading.value = true;
  try {
    const calendars = await Promise.all(months.map((m) => attendanceApi.calendar(m)));
    week.value = calendars.flatMap((c) => c.days).filter((d) => d.date >= start && d.date <= end);
  } catch {
    week.value = [];
  } finally {
    weekLoading.value = false;
  }
}
watch(() => data.value?.date, loadWeek);

/** Location is attached when the browser shares it; offices with a geofence need it, so we wait longer and ask for accuracy. */
function position(): Promise<{ latitude?: number; longitude?: number }> {
  if (!('geolocation' in navigator)) return Promise.resolve({});
  const needed = !!data.value?.geofence;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve({}),
      { timeout: needed ? 10_000 : 4000, maximumAge: needed ? 0 : 60_000, enableHighAccuracy: needed },
    );
  });
}

async function punch() {
  busy.value = true;
  try {
    if (open.value) {
      today.data.value = await attendanceApi.punchOut();
      feedback.success('Punched out', `Worked ${formatMinutes(today.data.value.record?.workedMinutes)} today.`);
    } else {
      today.data.value = await attendanceApi.punchIn(await position());
      const late = today.data.value.openRecord?.lateMinutes ?? 0;
      feedback.success('Punched in', late ? `You are ${formatMinutes(late)} late today.` : 'Have a great day!');
    }
    emit('changed');
    void loadWeek();
  } catch (e) {
    feedback.error(open.value ? 'Could not punch out' : 'Could not punch in', e);
    await today.run();
  } finally {
    busy.value = false;
  }
}

defineExpose({ reload: () => Promise.all([today.run(), loadWeek()]) });
</script>

<template>
  <section class="card overflow-hidden" aria-label="Today's attendance">
    <div v-if="today.loading.value && !data" class="p-4 sm:p-5"><AppSkeleton :lines="4" /></div>
    <div v-else-if="today.error.value" class="p-4 sm:p-5"><AppErrorState :error="today.error.value" @retry="today.run" /></div>
    <div v-else-if="data && !data.employee" class="p-4 sm:p-5">
      <AppEmptyState compact title="No employee record linked" description="Ask HR to link your account to your employee record to record attendance." />
    </div>
    <template v-else-if="data">
      <div class="p-4 sm:p-5">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p class="inline-flex min-w-0 items-center gap-2 text-sm" role="status">
            <span class="relative flex h-2 w-2 shrink-0">
              <span v-if="status.tone === 'live'" class="absolute inset-0 animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
              <span :class="['relative h-2 w-2 rounded-full', dotClass[status.tone]]" />
            </span>
            <span class="font-medium text-fg">{{ status.label }}</span>
            <span v-if="status.detail" class="truncate text-fg-muted">{{ status.detail }}</span>
          </p>
          <p class="text-xs text-fg-muted tabular-nums">{{ nowLabel }}</p>
        </div>

        <div class="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-0">
            <p class="text-xs font-medium text-fg-muted">Worked today</p>
            <p :class="['mt-1 text-title leading-none font-semibold tracking-tight tabular-nums', worked ? 'text-fg' : 'text-fg-subtle']" aria-live="off">
              {{ Math.floor(worked / 60) }}<span class="ms-0.5 me-1.5 text-lg font-medium text-fg-muted">h</span>{{ String(worked % 60).padStart(2, '0') }}<span class="ms-0.5 text-lg font-medium text-fg-muted">m</span>
            </p>
            <p class="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              {{ subline }}
              <AppBadge v-if="done?.status" :tone="dayStatusTone[done.status]" dot>{{ DAY_STATUS_LABELS[done.status] }}</AppBadge>
              <AppBadge v-if="done?.overtimeMinutes" tone="violet">Overtime {{ formatMinutes(done.overtimeMinutes) }}</AppBadge>
            </p>
          </div>

          <div class="w-full sm:w-56">
            <AppButton v-if="canPunch && !done" block size="lg" :variant="open || dayOff ? 'secondary' : 'primary'" :icon="open ? LogOut : LogIn" :loading="busy" @click="punch">
              {{ open ? 'Punch out' : 'Punch in' }}
            </AppButton>
            <p v-else-if="data.periodClosed" class="text-xs text-fg-muted sm:text-end">This month's attendance is closed.</p>
          </div>
        </div>

        <DayTrack
          v-if="showTrack"
          class="mt-4"
          :start="data.shift!.startTime"
          :end="data.shift!.endTime"
          :check-in-at="(open ?? done)?.checkInAt"
          :check-out-at="done?.checkOutAt"
          :late-minutes="(open ?? done)?.lateMinutes"
          :now="now"
          :time-zone="tz"
        />

        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
          <span class="inline-flex items-center gap-1.5"><Clock :size="13" aria-hidden="true" />{{ data.shift?.name }} shift<template v-if="!showTrack"> · {{ data.shift?.startTime }}–{{ data.shift?.endTime }}</template></span>
          <AppBadge v-if="data.rostered" tone="brand">Rostered</AppBadge>
          <AppBadge v-if="data.workFromHome" tone="info"><House :size="11" /> Working from home</AppBadge>
          <span v-if="data.geofence && canPunch && !done" class="inline-flex items-center gap-1.5"><MapPin :size="13" aria-hidden="true" />Within {{ data.geofence.radiusMetres }} m of {{ data.geofence.location }}</span>
        </div>
      </div>

      <div class="border-t border-line/70 px-4 pt-4 pb-3 sm:px-5">
        <WeekHoursChart :days="week" :loading="weekLoading && !week.length" :today="data.date!" :live-minutes="open ? workedSoFar : 0" :target-minutes="target" :time-zone="tz" />
      </div>
    </template>
  </section>
</template>
