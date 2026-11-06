<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Clock, LogIn, LogOut, PartyPopper, Sun } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { DAY_STATUS_LABELS, dayStatusTone, formatMinutes, formatTime } from '@/modules/attendance/utils/attendance-format';
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
const clock = computed(() => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz.value }).format(new Date(now.value)));
const dateLabel = computed(() => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz.value }).format(new Date(now.value)));
const workedSoFar = computed(() => (open.value?.checkInAt ? Math.max(0, Math.floor((now.value - new Date(open.value.checkInAt).getTime()) / 60_000)) : 0));
const progress = computed(() => Math.min(100, (workedSoFar.value / (data.value?.shift?.fullDayMinutes || 480)) * 100));

/** Location is optional: it is attached when the browser shares it within a few seconds. */
function position(): Promise<{ latitude?: number; longitude?: number }> {
  if (!('geolocation' in navigator)) return Promise.resolve({});
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve({}),
      { timeout: 4000, maximumAge: 60_000 },
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
  } catch (e) {
    feedback.error(open.value ? 'Could not punch out' : 'Could not punch in', e);
    await today.run();
  } finally {
    busy.value = false;
  }
}

defineExpose({ reload: () => today.run() });
</script>

<template>
  <section class="card relative overflow-hidden p-5 sm:p-6">
    <div class="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
    <AppSkeleton v-if="today.loading.value && !data" :lines="3" />
    <AppErrorState v-else-if="today.error.value" :error="today.error.value" @retry="today.run" />
    <AppEmptyState v-else-if="data && !data.employee" compact title="No employee record linked" description="Ask HR to link your account to your employee record to record attendance." />
    <div v-else-if="data" class="relative flex flex-wrap items-center gap-6">
      <div class="min-w-0 flex-1">
        <p class="text-sm text-fg-muted">{{ dateLabel }}</p>
        <p class="mt-1 font-mono text-4xl font-semibold tracking-tight text-fg tabular-nums sm:text-5xl" aria-live="off">{{ clock }}</p>
        <p class="mt-2 inline-flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <Clock :size="14" aria-hidden="true" />
          {{ data.shift?.name }} · {{ data.shift?.startTime }}–{{ data.shift?.endTime }}
          <AppBadge v-if="data.holiday && !data.holiday.isOptional" tone="violet"><PartyPopper :size="11" /> {{ data.holiday.name }}</AppBadge>
          <AppBadge v-else-if="data.holiday" tone="violet">Optional holiday · {{ data.holiday.name }}</AppBadge>
          <AppBadge v-else-if="data.isWeeklyOff"><Sun :size="11" /> Weekly off</AppBadge>
        </p>
      </div>

      <div class="w-full sm:w-auto sm:min-w-72">
        <template v-if="open">
          <div class="flex items-baseline justify-between gap-4 text-sm">
            <span class="text-fg-muted">In at <span class="font-semibold text-fg">{{ formatTime(open.checkInAt, tz) }}</span></span>
            <AppBadge v-if="open.lateMinutes" tone="warning">Late {{ formatMinutes(open.lateMinutes) }}</AppBadge>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Worked today" :aria-valuenow="workedSoFar" :aria-valuemax="data.shift?.fullDayMinutes">
            <div class="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-700" :style="{ width: `${progress}%` }" />
          </div>
          <p class="mt-1.5 text-xs text-fg-muted">Worked {{ formatMinutes(workedSoFar) }} of {{ formatMinutes(data.shift?.fullDayMinutes) }}</p>
        </template>
        <dl v-else-if="done" class="grid grid-cols-3 gap-3 text-sm">
          <div><dt class="text-xs text-fg-muted">In</dt><dd class="font-semibold text-fg">{{ formatTime(done.checkInAt, tz) }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Out</dt><dd class="font-semibold text-fg">{{ formatTime(done.checkOutAt, tz) }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Worked</dt><dd class="font-semibold text-fg">{{ formatMinutes(done.workedMinutes) }}</dd></div>
          <div class="col-span-3"><AppBadge v-if="done.status" :tone="dayStatusTone[done.status]" dot>{{ DAY_STATUS_LABELS[done.status] }}</AppBadge></div>
        </dl>
        <p v-else class="text-sm text-fg-muted">You haven't punched in today.</p>

        <AppButton
          v-if="canPunch && !done"
          class="mt-4"
          block
          size="lg"
          :variant="open ? 'danger' : 'primary'"
          :icon="open ? LogOut : LogIn"
          :loading="busy"
          @click="punch"
        >
          {{ open ? 'Punch out' : 'Punch in' }}
        </AppButton>
        <p v-else-if="data.periodClosed" class="mt-3 text-xs text-fg-muted">This month's attendance is closed.</p>
      </div>
    </div>
  </section>
</template>
