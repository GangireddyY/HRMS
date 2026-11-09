<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  BookOpenCheck,
  CalendarClock,
  ChevronRight,
  Clock,
  CodeXml,
  Compass,
  Flag,
  GraduationCap,
  HardHat,
  HeartHandshake,
  Library,
  MonitorPlay,
  RotateCcw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
} from '@lucide/vue';
import type { CourseCategory, CourseDelivery } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { useAuthStore } from '@/core/auth/auth.store';
import { trainingApi } from '@/modules/training/api/training.api';
import type { Enrollment } from '@/modules/training/types';
import { CATEGORY_LABELS, CERTIFICATION_LABELS, DELIVERY_LABELS, ENROLLMENT_STATUS_LABELS, certificationTone, enrollmentTone, sessionWhen } from '@/modules/training/utils/training-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate } from '@/shared/utils/format';

/** Self-service learning: what to do next, courses in progress, upcoming sessions and certificates. */
const auth = useAuthStore();
const canBrowse = computed(() => auth.can('training.view'));
const list = useAsync(() => fetchAllPages((page, pageSize) => trainingApi.enrollments({ view: 'mine', page, pageSize })));
const rows = computed(() => list.data.value ?? []);
const todo = computed(() => rows.value.filter((e) => e.status === 'ENROLLED' || e.status === 'IN_PROGRESS').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')));
const done = computed(() => rows.value.filter((e) => e.status === 'COMPLETED'));
const other = computed(() => rows.value.filter((e) => e.status === 'FAILED' || e.status === 'NO_SHOW'));
const line = (e: Enrollment) =>
  [DELIVERY_LABELS[e.course.delivery], e.course.durationHours ? `${e.course.durationHours} h` : null, e.session ? sessionWhen(e.session) : null, e.source === 'ASSIGNED' ? 'assigned to you' : null].filter(Boolean).join(' · ');

// ---- Visuals ---------------------------------------------------------------------------------------------------
const CATEGORY_VISUALS: Record<CourseCategory, { icon: Component; tile: string }> = {
  TECHNICAL: { icon: CodeXml, tile: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
  SOFT_SKILLS: { icon: HeartHandshake, tile: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300' },
  LEADERSHIP: { icon: Compass, tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  COMPLIANCE: { icon: ShieldCheck, tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  ONBOARDING: { icon: Rocket, tile: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  SAFETY: { icon: HardHat, tile: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300' },
  OTHER: { icon: Sparkles, tile: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300' },
};
const DELIVERY_ICON: Record<CourseDelivery, Component> = { CLASSROOM: GraduationCap, VIRTUAL: MonitorPlay, SELF_PACED: BookOpen };

// ---- Dates -----------------------------------------------------------------------------------------------------
const DAY = 86_400_000;
const now = Date.now();
const startOfToday = new Date(new Date().toDateString()).getTime();
const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
const daysUntil = (iso: string) => Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - startOfToday) / DAY);
function relativeDay(iso: string): string {
  const n = daysUntil(iso);
  if (Math.abs(n) < 14) return rtf.format(n, 'day');
  if (Math.abs(n) < 60) return rtf.format(Math.round(n / 7), 'week');
  return rtf.format(Math.round(n / 30), 'month');
}
/** Due-date chip: red when overdue, amber within a week. */
function due(e: Enrollment): { text: string; tone: string } | null {
  if (!e.dueDate) return null;
  if (e.overdue) return { text: `Overdue · was due ${formatDate(e.dueDate)}`, tone: 'bg-danger-soft text-danger-fg' };
  const n = daysUntil(e.dueDate);
  return { text: `Due ${relativeDay(e.dueDate)}`, tone: n <= 7 ? 'bg-warning-soft text-warning-fg' : 'bg-surface-muted text-fg-muted' };
}
const tile = (iso: string) => {
  const d = new Date(iso);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }), time: d.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' }) };
};

// ---- Summary ---------------------------------------------------------------------------------------------------
const overdue = computed(() => todo.value.filter((e) => e.overdue));
const required = computed(() => todo.value.filter((e) => e.course.mandatory || e.source === 'ASSIGNED'));
const dueSoon = computed(() => todo.value.filter((e) => !e.overdue && e.dueDate && daysUntil(e.dueDate) <= 14));
const finishedShare = computed(() => (done.value.length + todo.value.length ? Math.round((done.value.length / (done.value.length + todo.value.length)) * 100) : 0));
const hoursLearned = computed(() => Math.round(done.value.reduce((s, e) => s + (e.course.durationHours ?? 0), 0) * 10) / 10);
const expiring = computed(() => done.value.filter((e) => e.certification === 'EXPIRING' || e.certification === 'EXPIRED'));
const nextUp = computed(() => todo.value.find((e) => e.overdue) ?? todo.value.find((e) => e.dueDate) ?? todo.value.find((e) => e.status === 'IN_PROGRESS') ?? todo.value[0] ?? null);
const firstName = computed(() => auth.user?.firstName ?? '');
const headline = computed(() => {
  if (overdue.value.length) return `${overdue.value.length} course${overdue.value.length === 1 ? ' is' : 's are'} overdue`;
  if (todo.value.length) return `${todo.value.length} course${todo.value.length === 1 ? '' : 's'} on your list${firstName.value ? `, ${firstName.value}` : ''}`;
  return done.value.length ? `You're all caught up${firstName.value ? `, ${firstName.value}` : ''}` : 'Start learning something new';
});
const subline = computed(() => {
  if (overdue.value.length) return 'Finish overdue training first — assigned and required courses are tracked by your manager and HR.';
  if (dueSoon.value.length) return `${dueSoon.value.length} due in the next two weeks. Keep the momentum going.`;
  if (todo.value.length) return 'No deadlines pressing. Pick up where you left off whenever you have a moment.';
  return done.value.length ? 'Nothing in progress. Browse the catalog for your next course.' : 'Enrol in a course from the catalog, or wait for training your manager assigns.';
});
const stats = computed(() => [
  { key: 'todo', label: 'In progress & to start', value: todo.value.length, hint: `${todo.value.filter((e) => e.status === 'IN_PROGRESS').length} started`, icon: BookOpen, tone: 'text-accent-fg bg-accent-soft' },
  { key: 'overdue', label: 'Overdue', value: overdue.value.length, hint: dueSoon.value.length ? `${dueSoon.value.length} more due soon` : 'Nothing due soon', icon: AlertTriangle, tone: overdue.value.length ? 'text-danger-fg bg-danger-soft' : 'text-fg-muted bg-surface-muted' },
  { key: 'certs', label: 'Certificates', value: done.value.length, hint: expiring.value.length ? `${expiring.value.length} need renewal` : 'All current', icon: Award, tone: expiring.value.length ? 'text-warning-fg bg-warning-soft' : 'text-success-fg bg-success-soft' },
  { key: 'hours', label: 'Hours learned', value: hoursLearned.value, hint: 'From completed courses', icon: Clock, tone: 'text-violet-700 bg-violet-500/10 dark:text-violet-300' },
]);
const CIRC = 2 * Math.PI * 42;

// ---- To-do filter ----------------------------------------------------------------------------------------------
type Show = 'all' | 'required' | 'overdue';
const show = ref<Show>('all');
const showOptions = computed(() => [
  { value: 'all' as const, label: `All ${todo.value.length}` },
  { value: 'required' as const, label: `Required ${required.value.length}` },
  { value: 'overdue' as const, label: `Overdue ${overdue.value.length}` },
]);
const shown = computed(() => (show.value === 'required' ? required.value : show.value === 'overdue' ? overdue.value : todo.value));

const sessions = computed(() =>
  todo.value.filter((e) => e.session && new Date(e.session.startsAt).getTime() > now).sort((a, b) => a.session!.startsAt.localeCompare(b.session!.startsAt)),
);
const mix = computed(() => {
  const by = new Map<CourseCategory, { total: number; done: number }>();
  for (const e of [...todo.value, ...done.value]) {
    const m = by.get(e.course.category) ?? { total: 0, done: 0 };
    m.total++;
    if (e.status === 'COMPLETED') m.done++;
    by.set(e.course.category, m);
  }
  return [...by.entries()].map(([category, m]) => ({ category, ...m })).sort((a, b) => b.total - a.total);
});
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My learning" description="Courses you're taking, what's due, upcoming sessions and your certificates.">
      <template #actions>
        <AppButton v-if="canBrowse" variant="secondary" :icon="Target" to="/me/skills">My skills</AppButton>
        <AppButton :icon="Library" to="/me/training/catalog">Browse catalog</AppButton>
      </template>
    </AppPageHeader>
    <AppSkeleton v-if="list.loading.value && !list.data.value" :lines="6" />
    <AppErrorState v-else-if="list.error.value" :error="list.error.value" title="Could not load your learning" @retry="list.run" />
    <template v-else>
      <!-- Summary -->
      <section class="card overflow-hidden" aria-labelledby="learning-title">
        <div class="relative flex flex-wrap items-center gap-6 hero-banner px-6 py-6 text-white">
          <div class="relative min-w-0 flex-1 basis-72">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur"><GraduationCap :size="13" aria-hidden="true" />Your learning</p>
            <h2 id="learning-title" class="mt-3 text-2xl font-semibold tracking-tight">{{ headline }}</h2>
            <p class="mt-1 max-w-2xl text-sm text-white/85">{{ subline }}</p>
          </div>
          <div v-if="rows.length" class="relative flex items-center gap-4">
            <div class="relative h-28 w-28">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-white/20" />
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" class="stroke-white transition-[stroke-dashoffset] duration-700" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - finishedShare / 100)" />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-2xl font-semibold tabular-nums">{{ finishedShare }}%</span>
                <span class="text-2xs text-white/80">completed</span>
              </div>
            </div>
            <p class="text-sm text-white/85">
              <span class="block text-2xl font-semibold text-white tabular-nums">{{ done.length }}<span class="text-base font-normal text-white/70">/{{ done.length + todo.length }}</span></span>courses finished
            </p>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-px bg-line/70 xl:grid-cols-4">
          <div v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-4 py-3.5 sm:px-5">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg max-sm:hidden', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
            <div class="min-w-0">
              <p class="text-xl leading-6 font-semibold text-fg tabular-nums">{{ s.value }}</p>
              <p class="truncate text-xs font-medium text-fg-muted">{{ s.label }}</p>
              <p class="truncate text-2xs text-fg-subtle">{{ s.hint }}</p>
            </div>
          </div>
        </div>
        <div v-if="nextUp" :class="['flex flex-wrap items-center gap-3 border-t border-line/70 px-5 py-3', nextUp.overdue ? 'bg-danger-soft/40' : 'bg-accent-soft/40']">
          <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white', nextUp.overdue ? 'bg-danger' : 'bg-brand-600']" aria-hidden="true"><Flag :size="15" /></span>
          <div class="min-w-0 flex-1">
            <p :class="['text-2xs font-semibold tracking-wide uppercase', nextUp.overdue ? 'text-danger-fg' : 'text-accent-fg']">Next up</p>
            <p class="truncate text-sm font-medium text-fg">
              {{ nextUp.course.title }}
              <span class="ms-1 text-xs font-normal text-fg-muted">· {{ ENROLLMENT_STATUS_LABELS[nextUp.status] }}<template v-if="due(nextUp)"> · {{ due(nextUp)!.text }}</template><template v-else-if="nextUp.session"> · session {{ relativeDay(nextUp.session.startsAt) }}</template></span>
            </p>
          </div>
          <AppButton size="sm" :icon-right="ArrowRight" :to="`/me/training/enrollments/${nextUp.id}`">{{ nextUp.status === 'IN_PROGRESS' ? 'Continue' : 'Start course' }}</AppButton>
        </div>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0 space-y-4">
          <!-- To do -->
          <section class="card" aria-labelledby="todo-title">
            <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-2.5">
              <div class="flex items-center gap-3">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><BookOpen :size="16" /></span>
                <div>
                  <h2 id="todo-title" class="text-sm font-semibold text-fg">To do</h2>
                  <p class="text-xs text-fg-muted">Sorted by due date. Required courses are assigned to you or mandatory.</p>
                </div>
              </div>
              <AppSegmented v-if="todo.length" v-model="show" class="w-full sm:w-auto" size="sm" :options="showOptions" label="Show courses" />
            </header>
            <AppEmptyState v-if="!todo.length" :icon="BookOpenCheck" title="Nothing to do" :description="canBrowse ? 'Courses you enrol in or are assigned appear here. Find your next one in the catalog.' : 'Courses you enrol in or are assigned appear here.'" compact>
              <AppButton v-if="canBrowse" size="sm" variant="secondary" :icon="Library" to="/me/training/catalog">Browse catalog</AppButton>
            </AppEmptyState>
            <AppEmptyState v-else-if="!shown.length" compact :icon="BookOpenCheck" :title="show === 'overdue' ? 'Nothing overdue' : 'No required courses'" description="Nice — switch back to see everything on your list.">
              <AppButton size="sm" variant="secondary" @click="show = 'all'">Show all</AppButton>
            </AppEmptyState>
            <ul v-else class="divide-y divide-line/70">
              <li v-for="e in shown" :key="e.id">
                <RouterLink :to="`/me/training/enrollments/${e.id}`" :class="['relative flex flex-wrap items-center gap-4 px-4 py-3.5 transition hover:bg-surface-muted/50', e.overdue && 'bg-danger-soft/20']">
                  <span v-if="e.overdue" class="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden="true" />
                  <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', CATEGORY_VISUALS[e.course.category].tile]" :title="CATEGORY_LABELS[e.course.category]" aria-hidden="true">
                    <component :is="CATEGORY_VISUALS[e.course.category].icon" :size="18" />
                  </span>
                  <div class="min-w-0 flex-1 basis-56">
                    <p class="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                      {{ e.course.title }}
                      <AppBadge v-if="e.course.mandatory" size="sm" tone="violet">Mandatory</AppBadge>
                      <AppBadge v-else-if="e.source === 'ASSIGNED'" size="sm" tone="info">Assigned</AppBadge>
                    </p>
                    <p class="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-muted">
                      <component :is="DELIVERY_ICON[e.course.delivery]" :size="12" class="shrink-0" aria-hidden="true" />
                      <span class="truncate"><span class="font-mono">{{ e.course.code }}</span> · {{ line(e) }}</span>
                    </p>
                  </div>
                  <span v-if="due(e)" :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', due(e)!.tone]">
                    <AlertTriangle v-if="e.overdue" :size="12" aria-hidden="true" /><CalendarClock v-else :size="12" aria-hidden="true" />{{ due(e)!.text }}
                  </span>
                  <span v-else class="text-xs text-fg-subtle">No due date</span>
                  <AppBadge :tone="enrollmentTone[e.status]" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
                  <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
                </RouterLink>
              </li>
            </ul>
          </section>

          <!-- Certificates -->
          <AppCard title="Certificates" :icon="Award" :description="done.length ? `${done.length} earned${expiring.length ? ` · ${expiring.length} need renewal` : ''}` : 'Earned when you complete a course.'">
            <AppEmptyState v-if="!done.length" :icon="Award" title="No certificates yet" description="Finish a course to earn one. It appears here with its number and validity." compact />
            <ul v-else class="grid gap-3 md:grid-cols-2">
              <li v-for="e in done" :key="e.id">
                <RouterLink :to="`/me/training/enrollments/${e.id}`" class="group flex h-full flex-col rounded-xl p-4 ring-1 ring-line transition hover:bg-surface-muted/40 hover:ring-line-strong">
                  <div class="flex items-start gap-3">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-amber-50 text-amber-600 ring-1 ring-amber-500/25 dark:from-amber-500/20 dark:to-amber-500/5 dark:text-amber-300" aria-hidden="true">
                      <Award :size="18" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-semibold text-fg">{{ e.course.title }}</p>
                      <p class="truncate text-xs text-fg-muted">{{ CATEGORY_LABELS[e.course.category] }}<template v-if="e.course.durationHours"> · {{ e.course.durationHours }} h</template></p>
                    </div>
                    <AppBadge v-if="e.certification" :tone="certificationTone[e.certification]" size="sm" dot>{{ CERTIFICATION_LABELS[e.certification] }}</AppBadge>
                  </div>
                  <dl class="mt-4 grid grid-cols-2 gap-2 border-t border-dashed border-line pt-3 text-xs">
                    <div>
                      <dt class="text-fg-subtle">Completed</dt>
                      <dd class="mt-0.5 font-medium text-fg">{{ formatDate(e.completedOn!) }}</dd>
                    </div>
                    <div>
                      <dt class="text-fg-subtle">{{ e.expiresOn ? (e.certification === 'EXPIRED' ? 'Expired' : 'Valid until') : 'Validity' }}</dt>
                      <dd :class="['mt-0.5 font-medium', e.certification === 'EXPIRED' ? 'text-danger-fg' : e.certification === 'EXPIRING' ? 'text-warning-fg' : 'text-fg']">
                        {{ e.expiresOn ? `${formatDate(e.expiresOn)} · ${relativeDay(e.expiresOn)}` : 'Does not expire' }}
                      </dd>
                    </div>
                    <div v-if="e.certificateNumber" class="col-span-2">
                      <dt class="text-fg-subtle">Certificate no.</dt>
                      <dd class="mt-0.5 font-mono text-fg">{{ e.certificateNumber }}</dd>
                    </div>
                  </dl>
                </RouterLink>
              </li>
            </ul>
          </AppCard>

          <!-- Not completed -->
          <AppCard v-if="other.length" title="Not completed" :icon="RotateCcw" description="Courses you didn't pass or whose session you missed. You can enrol again." :padded="false">
            <ul class="divide-y divide-line/70">
              <li v-for="e in other" :key="e.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
                <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', CATEGORY_VISUALS[e.course.category].tile]" aria-hidden="true">
                  <component :is="CATEGORY_VISUALS[e.course.category].icon" :size="16" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ e.course.title }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ DELIVERY_LABELS[e.course.delivery] }}<template v-if="e.bestScore !== null"> · best score {{ e.bestScore }}%</template><template v-if="e.attempts"> · {{ e.attempts }} attempt{{ e.attempts === 1 ? '' : 's' }}</template></p>
                </div>
                <AppBadge :tone="enrollmentTone[e.status]" size="sm" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
                <AppButton size="sm" variant="secondary" :icon="RotateCcw" :to="`/me/training/courses/${e.course.id}`">Try again</AppButton>
              </li>
            </ul>
          </AppCard>
        </div>

        <aside class="space-y-4">
          <AppCard title="Upcoming sessions" :padded="false">
            <AppEmptyState v-if="!sessions.length" compact :icon="CalendarClock" title="No sessions booked" description="Classroom and live virtual courses show their dates here. Self-paced courses can be taken any time." />
            <ul v-else class="divide-y divide-line/70">
              <li v-for="e in sessions" :key="e.id">
                <RouterLink :to="`/me/training/enrollments/${e.id}`" class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50">
                  <div class="flex w-11 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1">
                    <span class="text-2xs font-semibold text-fg-muted uppercase">{{ tile(e.session!.startsAt).month }}</span>
                    <span class="text-base leading-5 font-semibold text-fg tabular-nums">{{ tile(e.session!.startsAt).day }}</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-fg">{{ e.course.title }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ tile(e.session!.startsAt).time }} · {{ relativeDay(e.session!.startsAt) }}<template v-if="e.session!.location"> · {{ e.session!.location }}</template></p>
                  </div>
                </RouterLink>
              </li>
            </ul>
          </AppCard>

          <AppCard v-if="mix.length" title="Your learning mix">
            <ul class="space-y-3">
              <li v-for="m in mix" :key="m.category">
                <div class="mb-1 flex items-center gap-2 text-xs">
                  <component :is="CATEGORY_VISUALS[m.category].icon" :size="13" class="text-fg-muted" aria-hidden="true" />
                  <span class="flex-1 font-medium text-fg">{{ CATEGORY_LABELS[m.category] }}</span>
                  <span class="text-fg-muted tabular-nums">{{ m.done }} of {{ m.total }} done</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <div class="h-full rounded-full bg-brand-500" :style="{ width: `${(m.done / m.total) * 100}%` }" />
                </div>
              </li>
            </ul>
          </AppCard>

          <section v-if="canBrowse" class="card overflow-hidden">
            <div class="bg-gradient-to-br from-violet-500/10 via-transparent to-sky-500/10 p-4">
              <p class="flex items-center gap-2 text-sm font-semibold text-fg"><Sparkles :size="15" class="text-violet-500" aria-hidden="true" />Grow your skills</p>
              <p class="mt-1 text-xs text-fg-muted">See which skills your role needs and find courses that close the gaps.</p>
              <div class="mt-3 flex gap-2">
                <AppButton class="flex-1" size="sm" variant="secondary" :icon="Target" to="/me/skills">My skills</AppButton>
                <AppButton class="flex-1" size="sm" variant="secondary" :icon="Library" to="/me/training/catalog">Catalog</AppButton>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>
