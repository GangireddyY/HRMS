<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CalendarCheck2, CalendarClock, CalendarPlus, ChevronRight, ListTodo, MessagesSquare, UsersRound } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { appLocale } from '@/core/locale/locale';
import { performanceApi } from '@/modules/performance/api/performance.api';
import ScheduleOneOnOneModal from '@/modules/performance/components/ScheduleOneOnOneModal.vue';
import type { OneOnOneDetail, OneOnOneRow } from '@/modules/performance/types';
import { ONE_ON_ONE_STATUS_LABELS, oneOnOneTone } from '@/modules/performance/utils/performance-format';
import { AppAvatar, AppBadge, AppButton, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** 1:1s: your own with your manager, and (for managers) the ones you hold with your people. */
const auth = useAuthStore();
const router = useRouter();
const feedback = useFeedbackStore();
const isManager = computed(() => auth.can('performance.review'));
const tab = ref(isManager.value ? 'team' : 'mine');
const tabs = computed(() => [
  ...(isManager.value ? [{ key: 'team', label: 'My team', icon: UsersRound }] : []),
  { key: 'mine', label: 'My 1:1s', icon: MessagesSquare },
]);
const meetings = useAsync(() => performanceApi.oneOnOnes({ view: tab.value as 'mine' | 'team', pageSize: 100 }));
const team = useAsync(() => performanceApi.oneOnOneTeam(), { immediate: isManager.value });
watch(tab, () => void meetings.run());

const rows = computed(() => meetings.data.value?.items ?? []);
const upcoming = computed(() => rows.value.filter((m) => m.status === 'SCHEDULED').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)));
const past = computed(() => rows.value.filter((m) => m.status !== 'SCHEDULED'));

const dayFmt = new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(appLocale(), { hour: 'numeric', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat(appLocale(), { month: 'short' });
const when = (iso: string) => `${dayFmt.format(new Date(iso))} · ${timeFmt.format(new Date(iso))}`;
const other = (m: OneOnOneRow) => (tab.value === 'team' ? m.employee : m.manager);

const schedule = ref<{ open: boolean; employeeId: string | null }>({ open: false, employeeId: null });
function scheduled(m: OneOnOneDetail) {
  schedule.value = { open: false, employeeId: null };
  feedback.success('1:1 scheduled', `${m.employee.name} has been notified.`);
  void router.push(`/me/performance/one-on-ones/${m.id}`);
}
const cadence = (days: number | null) => (days === null ? 'text-fg-muted' : days > 30 ? 'text-danger-fg' : days > 14 ? 'text-warning-fg' : 'text-success-fg');
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="1:1s" description="Regular conversations between managers and their people: a shared agenda, notes and follow-up actions.">
      <template #actions>
        <AppButton v-if="isManager" :icon="CalendarPlus" @click="schedule = { open: true, employeeId: null }">Schedule 1:1</AppButton>
      </template>
    </AppPageHeader>

    <AppTabs v-if="tabs.length > 1" v-model="tab" :tabs="tabs" />

    <!-- Team roster -->
    <section v-if="tab === 'team'" aria-labelledby="roster-title">
      <h2 id="roster-title" class="sr-only">Your people</h2>
      <AppSkeleton v-if="team.loading.value && !team.data.value" :lines="3" />
      <AppErrorState v-else-if="team.error.value" :error="team.error.value" @retry="team.run" />
      <div v-else-if="!team.data.value?.length" class="card">
        <AppEmptyState compact :icon="UsersRound" title="No direct reports" description="People who report to you appear here, with their last and next 1:1." />
      </div>
      <ul v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="r in team.data.value" :key="r.employee.id" class="card flex flex-col p-4">
          <div class="flex items-center gap-3">
            <AppAvatar :name="r.employee.name" size="md" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-fg">{{ r.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ r.employee.department ?? r.employee.employeeCode }}</p>
            </div>
          </div>
          <dl class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-lg bg-surface-muted/60 px-2.5 py-2">
              <dt class="text-fg-subtle">Last 1:1</dt>
              <dd :class="['mt-0.5 font-medium', cadence(r.daysSinceLast)]">{{ r.last ? timeAgo(r.last.at) : 'Never' }}</dd>
            </div>
            <div class="rounded-lg bg-surface-muted/60 px-2.5 py-2">
              <dt class="text-fg-subtle">Next</dt>
              <dd :class="['mt-0.5 font-medium', r.next?.overdue ? 'text-danger-fg' : 'text-fg']">{{ r.next ? when(r.next.at) : 'Not booked' }}</dd>
            </div>
          </dl>
          <div class="mt-3 flex gap-2">
            <AppButton v-if="r.next" class="flex-1" size="sm" variant="secondary" :to="`/me/performance/one-on-ones/${r.next.id}`">Open agenda</AppButton>
            <AppButton v-else class="flex-1" size="sm" :icon="CalendarPlus" @click="schedule = { open: true, employeeId: r.employee.id }">Schedule</AppButton>
            <AppButton v-if="r.last" size="sm" variant="ghost" :to="`/me/performance/one-on-ones/${r.last.id}`">Last notes</AppButton>
          </div>
        </li>
      </ul>
    </section>

    <AppSkeleton v-if="meetings.loading.value && !meetings.data.value" :lines="5" />
    <AppErrorState v-else-if="meetings.error.value" :error="meetings.error.value" title="Could not load your 1:1s" @retry="meetings.run" />
    <div v-else-if="!rows.length" class="card">
      <AppEmptyState :icon="MessagesSquare" :title="tab === 'team' ? 'No 1:1s yet' : 'No 1:1s with your manager yet'" :description="tab === 'team' ? 'Schedule regular 1:1s with each person: weekly or fortnightly works well.' : 'When your manager schedules a 1:1 you can add topics to the agenda here.'" />
    </div>
    <div v-else class="grid items-start gap-4 xl:grid-cols-2">
      <section v-for="group in [{ key: 'upcoming', title: 'Upcoming', icon: CalendarClock, list: upcoming }, { key: 'past', title: 'Past', icon: CalendarCheck2, list: past }]" :key="group.key" class="card overflow-hidden" :aria-labelledby="`${group.key}-title`">
        <header class="flex items-center gap-2 border-b border-line/70 px-4 py-2.5">
          <component :is="group.icon" :size="16" class="text-fg-muted" aria-hidden="true" />
          <h2 :id="`${group.key}-title`" class="text-sm font-semibold text-fg">{{ group.title }}</h2>
          <span class="text-xs text-fg-subtle tabular-nums">{{ group.list.length }}</span>
        </header>
        <p v-if="!group.list.length" class="px-4 py-6 text-center text-sm text-fg-muted">{{ group.key === 'upcoming' ? 'Nothing scheduled.' : 'No past 1:1s yet.' }}</p>
        <ul v-else class="divide-y divide-line/70">
          <li v-for="m in group.list" :key="m.id">
            <RouterLink :to="`/me/performance/one-on-ones/${m.id}`" class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50">
              <span :class="['flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg leading-none', m.status === 'SCHEDULED' ? (m.overdue ? 'bg-danger-soft text-danger-fg' : 'bg-accent-soft text-accent-fg') : 'bg-surface-muted text-fg-muted']" aria-hidden="true">
                <span class="text-2xs font-semibold uppercase">{{ monthFmt.format(new Date(m.scheduledAt)) }}</span>
                <span class="text-base font-semibold tabular-nums">{{ new Date(m.scheduledAt).getDate() }}</span>
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-fg">1:1 with {{ other(m).name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ when(m.scheduledAt) }} · {{ m.durationMinutes }} min</p>
                <p class="mt-1 flex flex-wrap gap-x-3 text-2xs text-fg-subtle">
                  <span class="inline-flex items-center gap-1"><MessagesSquare :size="11" aria-hidden="true" />{{ m.topics }} topic{{ m.topics === 1 ? '' : 's' }}</span>
                  <span :class="['inline-flex items-center gap-1', m.openActions && 'text-warning-fg']"><ListTodo :size="11" aria-hidden="true" />{{ m.openActions }} open action{{ m.openActions === 1 ? '' : 's' }}</span>
                </p>
              </div>
              <AppBadge v-if="m.overdue" size="sm" tone="danger">Past due</AppBadge>
              <AppBadge v-else size="sm" :tone="oneOnOneTone[m.status]" dot>{{ ONE_ON_ONE_STATUS_LABELS[m.status] }}</AppBadge>
              <ChevronRight :size="16" class="shrink-0 text-fg-subtle rtl:rotate-180" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>

    <ScheduleOneOnOneModal :open="schedule.open" :team="team.data.value ?? []" :employee-id="schedule.employeeId" @close="schedule = { open: false, employeeId: null }" @saved="scheduled" />
  </div>
</template>
