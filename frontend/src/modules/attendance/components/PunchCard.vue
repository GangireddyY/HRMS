<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Camera, Clock, CloudOff, House, LogIn, LogOut, MapPin, Wifi, WifiOff } from '@lucide/vue';
import { ApiError } from '@/core/http/http-client';
import { currentPosition } from '@/core/native/native';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { ON_TIME_MS, addPunchCorrection, queuePunch, queuedPunches, setQueuedPunches, type PunchKind, type QueuedPunch } from '@/modules/attendance/utils/offline-punches';
import { localToday } from '@/shared/utils/dates';
import DayTrack from '@/modules/attendance/components/DayTrack.vue';
import PunchPhotoCapture from '@/modules/attendance/components/PunchPhotoCapture.vue';
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
  const pending = queued.value.at(-1);
  if (pending) return { label: pending.kind === 'IN' ? 'Punched in on this device' : 'Punched out on this device', detail: `at ${pending.time}, not sent yet`, tone: pending.kind === 'IN' ? 'live' : 'warning' };
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

/** Location is attached when the device shares it; offices with a geofence need it, so we wait longer and ask for accuracy. */
const position = () => currentPosition({ accurate: !!data.value?.geofence });

// ---- Offline punches ---------------------------------------------------------------------------------------------
const userId = computed(() => auth.user?.id ?? '');
const queued = ref<QueuedPunch[]>(userId.value ? queuedPunches(userId.value) : []);
/** What the next punch is, counting ones saved offline that the server hasn't seen yet. */
const nextKind = computed<PunchKind>(() => (queued.value.at(-1) ? (queued.value.at(-1)!.kind === 'IN' ? 'OUT' : 'IN') : open.value ? 'OUT' : 'IN'));
const hhmm = (ms: number) => {
  const m = minutesOfDay(ms);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const isOffline = (e: unknown) => !navigator.onLine || (e instanceof ApiError && e.code === 'NETWORK_ERROR');

function saveOffline(kind: PunchKind, location: { latitude?: number; longitude?: number; photo?: string }) {
  const at = Date.now();
  queuePunch(userId.value, { kind, at: new Date(at).toISOString(), date: data.value?.date ?? localToday(), time: hhmm(at), ...location });
  queued.value = queuedPunches(userId.value);
  feedback.warning(`Punch ${kind === 'IN' ? 'in' : 'out'} saved on this device`, "You're offline. It's sent as soon as the connection is back.");
}

let syncing = false;
async function syncOffline() {
  if (syncing || !userId.value || !navigator.onLine) return;
  const list = queuedPunches(userId.value);
  if (!list.length) return;
  syncing = true;
  try {
    while (list.length) {
      const p = list[0]!;
      try {
        today.data.value = p.kind === 'IN' ? await attendanceApi.punchIn({ latitude: p.latitude, longitude: p.longitude, photo: p.photo }) : await attendanceApi.punchOut();
        if (Date.now() - new Date(p.at).getTime() > ON_TIME_MS) addPunchCorrection(userId.value, { ...p, recordedAt: new Date().toISOString() });
      } catch (e) {
        if (isOffline(e)) break;
        feedback.warning(`A punch saved offline at ${p.time} couldn't be recorded`, e instanceof ApiError ? e.message : undefined);
      }
      list.shift();
      setQueuedPunches(userId.value, list);
    }
  } finally {
    syncing = false;
    queued.value = queuedPunches(userId.value);
    await today.run();
    emit('changed');
  }
}
onMounted(() => {
  void syncOffline();
  window.addEventListener('online', syncOffline);
});
onBeforeUnmount(() => window.removeEventListener('online', syncOffline));

// ---- Punch-in photo (where the location asks for one) ------------------------------------------------------------
const photoOpen = ref(false);
let photoResolve: ((photo: string | null) => void) | null = null;
function askPhoto(): Promise<string | null> {
  photoOpen.value = true;
  return new Promise((resolve) => (photoResolve = resolve));
}
function photoDone(photo: string | null) {
  photoOpen.value = false;
  photoResolve?.(photo);
  photoResolve = null;
}

async function punch() {
  busy.value = true;
  const kind = nextKind.value;
  let location: { latitude?: number; longitude?: number; photo?: string } = {};
  try {
    if (kind === 'IN' && data.value?.photoRequired) {
      const photo = await askPhoto();
      if (!photo) return;
      location.photo = photo;
    }
    if (queued.value.length) {
      // Earlier punches are still waiting to be sent: keep the order.
      if (kind === 'IN') location = { ...location, ...(await position()) };
      saveOffline(kind, location);
      void syncOffline();
      return;
    }
    if (kind === 'OUT') {
      today.data.value = await attendanceApi.punchOut();
      feedback.success('Punched out', `Worked ${formatMinutes(today.data.value.record?.workedMinutes)} today.`);
    } else {
      location = { ...location, ...(await position()) };
      today.data.value = await attendanceApi.punchIn(location);
      const late = today.data.value.openRecord?.lateMinutes ?? 0;
      feedback.success('Punched in', late ? `You are ${formatMinutes(late)} late today.` : 'Have a great day!');
    }
    emit('changed');
    void loadWeek();
  } catch (e) {
    if (isOffline(e)) {
      saveOffline(kind, location);
      return;
    }
    feedback.error(kind === 'OUT' ? 'Could not punch out' : 'Could not punch in', e);
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
            <AppButton v-if="canPunch && (!done || queued.length)" block size="lg" :variant="nextKind === 'OUT' || dayOff ? 'secondary' : 'primary'" :icon="nextKind === 'OUT' ? LogOut : LogIn" :loading="busy" @click="punch">
              {{ nextKind === 'OUT' ? 'Punch out' : 'Punch in' }}
            </AppButton>
            <p v-if="queued.length" class="mt-2 flex items-center gap-1.5 text-xs text-warning-fg sm:justify-end" role="status">
              <CloudOff :size="13" aria-hidden="true" />
              {{ queued.map((q) => `${q.kind === 'IN' ? 'In' : 'Out'} ${q.time}`).join(', ') }} saved on this device
            </p>
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
          <span v-if="data.officeNetwork && canPunch && !done && !open" :class="['inline-flex items-center gap-1.5', data.officeNetwork.onNetwork ? '' : 'font-medium text-warning-fg']">
            <component :is="data.officeNetwork.onNetwork ? Wifi : WifiOff" :size="13" aria-hidden="true" />{{ data.officeNetwork.onNetwork ? `On the ${data.officeNetwork.location} network` : `Connect to the ${data.officeNetwork.location} network to punch in` }}
          </span>
          <span v-if="data.photoRequired && canPunch && !done && !open" class="inline-flex items-center gap-1.5"><Camera :size="13" aria-hidden="true" />Photo needed to punch in</span>
        </div>
      </div>

      <div class="border-t border-line/70 px-4 pt-4 pb-3 sm:px-5">
        <WeekHoursChart :days="week" :loading="weekLoading && !week.length" :today="data.date!" :live-minutes="open ? workedSoFar : 0" :target-minutes="target" :time-zone="tz" />
      </div>
    </template>
    <PunchPhotoCapture :open="photoOpen" @close="photoDone(null)" @captured="photoDone" />
  </section>
</template>
