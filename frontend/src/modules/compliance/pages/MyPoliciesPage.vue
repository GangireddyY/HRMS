<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { AlertTriangle, ArrowRight, Ban, BookOpenCheck, CalendarDays, CheckCircle2, ChevronRight, CircleCheck, FileCheck2, FileText, Flag, HeartPulse, History, Laptop, Lock, Plane, Scale, ScrollText, ShieldCheck, Users } from '@lucide/vue';
import { POLICY_CATEGORIES, type PolicyCategory } from '@contracts';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import type { MyPolicy } from '@/modules/compliance/types';
import { POLICY_CATEGORY_LABELS, localIso } from '@/modules/compliance/utils/compliance-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** Self-service policies: what needs your acknowledgement (most urgent first), and everything else that applies to you. */
const mine = useAsync(() => complianceApi.mine());
const all = computed(() => mine.data.value ?? []);

/** Icon and colours per category (full class names, so Tailwind keeps them). */
const VISUALS: Record<PolicyCategory, { icon: Component; tile: string }> = {
  CODE_OF_CONDUCT: { icon: Scale, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-600/15 dark:bg-indigo-500/15 dark:text-indigo-300' },
  HR: { icon: Users, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300' },
  LEAVE: { icon: CalendarDays, tile: 'bg-teal-50 text-teal-600 ring-teal-600/15 dark:bg-teal-500/15 dark:text-teal-300' },
  IT_SECURITY: { icon: Laptop, tile: 'bg-violet-50 text-violet-600 ring-violet-600/15 dark:bg-violet-500/15 dark:text-violet-300' },
  DATA_PRIVACY: { icon: Lock, tile: 'bg-cyan-50 text-cyan-700 ring-cyan-600/15 dark:bg-cyan-500/15 dark:text-cyan-300' },
  HEALTH_SAFETY: { icon: HeartPulse, tile: 'bg-rose-50 text-rose-600 ring-rose-600/15 dark:bg-rose-500/15 dark:text-rose-300' },
  ANTI_BRIBERY: { icon: Ban, tile: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-300' },
  POSH: { icon: ShieldCheck, tile: 'bg-pink-50 text-pink-600 ring-pink-600/15 dark:bg-pink-500/15 dark:text-pink-300' },
  TRAVEL: { icon: Plane, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-300' },
  OTHER: { icon: FileText, tile: 'bg-slate-100 text-slate-600 ring-slate-600/15 dark:bg-slate-500/20 dark:text-slate-300' },
};

// ---- Due dates -------------------------------------------------------------------------------------------------
const today = localIso(new Date());
const daysUntil = (iso: string) => Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / 86_400_000);
function dueLabel(p: MyPolicy): string {
  const d = daysUntil(p.dueOn!);
  if (p.state === 'OVERDUE' || d < 0) return d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : 'Overdue';
  return d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
}
const dueTone = (p: MyPolicy) => (p.state === 'OVERDUE' ? 'bg-danger-soft text-danger-fg' : p.dueOn && daysUntil(p.dueOn) <= 3 ? 'bg-warning-soft text-warning-fg' : 'bg-surface-muted text-fg-muted');

// ---- Groups ----------------------------------------------------------------------------------------------------
const toDo = computed(() =>
  all.value
    .filter((p) => p.state === 'PENDING' || p.state === 'OVERDUE')
    .sort((a, b) => Number(b.state === 'OVERDUE') - Number(a.state === 'OVERDUE') || (a.dueOn ?? '').localeCompare(b.dueOn ?? '')),
);
const overdue = computed(() => toDo.value.filter((p) => p.state === 'OVERDUE'));
const acknowledged = computed(() => all.value.filter((p) => p.state === 'ACKNOWLEDGED').sort((a, b) => (b.acknowledgedAt ?? '').localeCompare(a.acknowledgedAt ?? '')));
const reference = computed(() => all.value.filter((p) => !p.state).sort((a, b) => a.title.localeCompare(b.title)));
const requiring = computed(() => toDo.value.length + acknowledged.value.length);
const pct = computed(() => (requiring.value ? Math.round((acknowledged.value.length / requiring.value) * 100) : 100));
const next = computed(() => toDo.value[0] ?? null);

const heroTitle = computed(() => {
  const n = toDo.value.length;
  if (n) return `${n} ${n === 1 ? 'policy needs' : 'policies need'} your acknowledgement`;
  return requiring.value ? "You're up to date" : 'Nothing to acknowledge';
});
const heroText = computed(() => {
  if (overdue.value.length) return `${overdue.value.length} ${overdue.value.length === 1 ? 'is' : 'are'} past the due date — please read and confirm as soon as you can.`;
  if (next.value?.dueOn) return `The next one is due on ${formatDate(next.value.dueOn)}. Read each policy, then confirm you have understood it.`;
  if (requiring.value) return 'You have acknowledged every policy that asks for it. Everything that applies to you stays available below.';
  return 'None of your policies ask for a confirmation. They stay available below for reference.';
});

// ---- Filters ---------------------------------------------------------------------------------------------------
type View = 'todo' | 'overdue' | 'acknowledged' | 'reference';
const view = ref<View | null>(null);
const category = ref<PolicyCategory | null>(null);
const strip = computed<StripItem[]>(() => [
  { key: 'todo', label: 'To acknowledge', value: toDo.value.length, hint: next.value?.dueOn ? `Next ${dueLabel(next.value).toLowerCase()}` : 'Nothing waiting for you', tone: 'warning' },
  { key: 'overdue', label: 'Overdue', value: overdue.value.length, hint: overdue.value.length ? 'Past their due date' : 'None overdue', tone: 'danger' },
  { key: 'acknowledged', label: 'Acknowledged', value: acknowledged.value.length, hint: acknowledged.value[0]?.acknowledgedAt ? `Last on ${formatDate(acknowledged.value[0].acknowledgedAt)}` : undefined, tone: 'success' },
  ...(reference.value.length ? [{ key: 'reference', label: 'For reference', value: reference.value.length, hint: 'No confirmation needed', tone: 'neutral' }] : []),
]);
const inCategory = (p: MyPolicy) => !category.value || p.category === category.value;
const groups = computed(() =>
  [
    { key: 'todo', title: 'Needs your acknowledgement', items: (view.value === 'overdue' ? overdue.value : toDo.value).filter(inCategory), show: !view.value || view.value === 'todo' || view.value === 'overdue' },
    { key: 'acknowledged', title: 'Acknowledged', items: acknowledged.value.filter(inCategory), show: !view.value || view.value === 'acknowledged' },
    { key: 'reference', title: 'For reference', items: reference.value.filter(inCategory), show: !view.value || view.value === 'reference' },
  ].filter((g) => g.show && g.items.length),
);
const categories = computed(() => POLICY_CATEGORIES.map((c) => ({ key: c, count: all.value.filter((p) => p.category === c).length })).filter((c) => c.count));
const filtered = computed(() => !!view.value || !!category.value);
function clearFilters() {
  view.value = null;
  category.value = null;
}

const HOW = [
  { title: 'Read the policy', text: 'Open it and read the current version; some include a document to download.' },
  { title: 'Confirm you understand it', text: 'Tick the confirmation and select Acknowledge, ideally before the due date.' },
  { title: "It's on record", text: 'Your acknowledgement is saved with the version and the date.' },
  { title: 'When a policy changes', text: 'You may be asked to confirm the new version; it reappears here.' },
];
const CIRC = 2 * Math.PI * 42;
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Policies" description="Company policies that apply to you. Read them and confirm you have." />
    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="6" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <AppCard v-else-if="mine.data.value && !all.length">
      <AppEmptyState :icon="ScrollText" title="No policies yet" description="Policies published by your organization appear here, along with any you need to read and acknowledge." />
    </AppCard>
    <template v-else-if="mine.data.value">
      <!-- Summary -->
      <section class="card overflow-hidden" aria-labelledby="ack-title">
        <div class="relative flex flex-wrap items-center gap-6 hero-banner px-6 py-6 text-white">
          <div class="relative min-w-0 flex-1">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
              <component :is="toDo.length ? BookOpenCheck : CircleCheck" :size="13" aria-hidden="true" />
              Policy acknowledgements
            </p>
            <h2 id="ack-title" class="mt-3 text-2xl font-semibold tracking-tight">{{ heroTitle }}</h2>
            <p class="mt-1 max-w-2xl text-sm text-white/85">{{ heroText }}</p>
            <ul class="mt-4 flex flex-wrap gap-2 text-xs">
              <li v-if="overdue.length" class="inline-flex items-center gap-1.5 rounded-full bg-red-500/35 px-2.5 py-1 font-medium ring-1 ring-white/25 ring-inset">
                <AlertTriangle :size="12" aria-hidden="true" />{{ overdue.length }} overdue
              </li>
              <li class="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 ring-1 ring-white/20 ring-inset">
                <ScrollText :size="12" aria-hidden="true" /><span class="tabular-nums">{{ all.length }}</span> {{ all.length === 1 ? 'policy applies' : 'policies apply' }} to you
              </li>
              <li v-if="reference.length" class="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 ring-1 ring-white/20 ring-inset">
                <FileText :size="12" aria-hidden="true" /><span class="tabular-nums">{{ reference.length }}</span> for reference only
              </li>
            </ul>
          </div>
          <div v-if="requiring" class="relative flex items-center gap-4">
            <div class="relative h-28 w-28">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-white/20" />
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" class="stroke-white transition-[stroke-dashoffset] duration-700" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - pct / 100)" />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-2xl font-semibold tabular-nums">{{ pct }}%</span>
                <span class="text-2xs text-white/80">acknowledged</span>
              </div>
            </div>
            <p class="text-sm text-white/85">
              <span class="block text-2xl font-semibold text-white tabular-nums">{{ acknowledged.length }}<span class="text-base font-normal text-white/70">/{{ requiring }}</span></span>
              confirmed
            </p>
          </div>
        </div>
        <div v-if="next" :class="['flex flex-wrap items-center gap-3 border-t border-line/70 px-5 py-3', next.state === 'OVERDUE' ? 'bg-danger-soft/40' : 'bg-accent-soft/40']">
          <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white', next.state === 'OVERDUE' ? 'bg-danger' : 'bg-brand-600']" aria-hidden="true"><Flag :size="15" /></span>
          <div class="min-w-0 flex-1">
            <p :class="['text-2xs font-semibold tracking-wide uppercase', next.state === 'OVERDUE' ? 'text-danger-fg' : 'text-accent-fg']">{{ next.state === 'OVERDUE' ? 'Overdue — do this first' : 'Next up' }}</p>
            <p class="truncate text-sm font-medium text-fg">
              {{ next.title }}
              <span :class="['ms-1 text-xs font-normal', next.state === 'OVERDUE' ? 'text-danger-fg' : 'text-fg-muted']">· {{ dueLabel(next) }}<template v-if="next.dueOn"> ({{ formatDate(next.dueOn) }})</template></span>
            </p>
          </div>
          <AppButton size="sm" :icon-right="ArrowRight" :to="`/me/policies/${next.id}`">Read and acknowledge</AppButton>
        </div>
        <div v-else-if="requiring" class="flex items-center gap-3 border-t border-line/70 bg-success-soft/50 px-5 py-3 text-sm text-success-fg">
          <CheckCircle2 :size="16" aria-hidden="true" />All your acknowledgements are up to date. Anything new that needs your confirmation will appear here.
        </div>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0 space-y-4">
          <AppStatStrip :items="strip" selectable :selected="view" label="Policy summary" @select="(k) => (view = k as View | null)" />

          <section class="card" aria-labelledby="policies-title">
            <header class="space-y-3 border-b border-line/70 px-4 py-3">
              <div class="flex items-center gap-3">
                <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ScrollText :size="16" /></span>
                <div class="min-w-0 flex-1">
                  <h2 id="policies-title" class="text-sm font-semibold text-fg">Your policies</h2>
                  <p class="text-xs text-fg-muted">Open a policy to read it in full{{ toDo.length ? ' and acknowledge it' : '' }}.</p>
                </div>
                <AppButton v-if="filtered" size="sm" variant="ghost" @click="clearFilters">Clear filters</AppButton>
              </div>
              <div v-if="categories.length > 1" class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
                <button
                  type="button"
                  :class="['inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 transition ring-inset', !category ? 'bg-fg text-surface ring-fg' : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg']"
                  :aria-pressed="!category"
                  @click="category = null"
                >
                  All <span class="tabular-nums opacity-70">{{ all.length }}</span>
                </button>
                <button
                  v-for="c in categories"
                  :key="c.key"
                  type="button"
                  :class="['inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 transition ring-inset', category === c.key ? 'bg-accent-soft text-accent-fg ring-brand-500/30' : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg']"
                  :aria-pressed="category === c.key"
                  @click="category = category === c.key ? null : c.key"
                >
                  <component :is="VISUALS[c.key].icon" :size="13" aria-hidden="true" />
                  {{ POLICY_CATEGORY_LABELS[c.key] }}
                  <span class="tabular-nums opacity-70">{{ c.count }}</span>
                </button>
              </div>
            </header>

            <div v-for="g in groups" :key="g.key">
              <h3 class="flex items-center gap-2 border-b border-line/60 bg-surface-muted/50 px-4 py-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                {{ g.title }} <span class="tabular-nums">· {{ g.items.length }}</span>
              </h3>
              <ul class="divide-y divide-line/70">
                <li v-for="p in g.items" :key="p.id" class="relative">
                  <span v-if="p.state === 'OVERDUE'" class="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden="true" />
                  <RouterLink
                    :to="`/me/policies/${p.id}`"
                    :class="['group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition hover:bg-surface-muted/50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-inset', p.state === 'OVERDUE' && 'bg-danger-soft/25']"
                  >
                    <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', VISUALS[p.category].tile]" aria-hidden="true">
                      <component :is="VISUALS[p.category].icon" :size="18" />
                    </span>
                    <div class="min-w-0 flex-1 basis-56">
                      <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="truncate font-medium text-fg">{{ p.title }}</span>
                        <AppBadge v-if="p.version.version > 1" size="sm" tone="info">Updated · v{{ p.version.version }}</AppBadge>
                      </p>
                      <p v-if="p.summary" class="truncate text-sm text-fg-muted">{{ p.summary }}</p>
                      <p class="mt-0.5 text-xs text-fg-subtle">
                        {{ POLICY_CATEGORY_LABELS[p.category] }} · version {{ p.version.version }}<template v-if="p.version.effectiveFrom"> · in force from {{ formatDate(p.version.effectiveFrom) }}</template>
                      </p>
                    </div>
                    <template v-if="p.state === 'PENDING' || p.state === 'OVERDUE'">
                      <span v-if="p.dueOn" :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', dueTone(p)]" :title="`Due by ${formatDate(p.dueOn)}`">
                        <component :is="p.state === 'OVERDUE' ? AlertTriangle : CalendarDays" :size="12" aria-hidden="true" />{{ dueLabel(p) }}
                      </span>
                      <AppBadge v-else :tone="p.state === 'OVERDUE' ? 'danger' : 'warning'" dot>{{ p.state === 'OVERDUE' ? 'Overdue' : 'To acknowledge' }}</AppBadge>
                      <span class="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-50 px-3 text-xs font-medium text-brand-700 transition group-hover:bg-brand-100 dark:bg-brand-500/12 dark:text-brand-300 dark:group-hover:bg-brand-500/20">
                        Review<ArrowRight :size="13" aria-hidden="true" />
                      </span>
                    </template>
                    <template v-else>
                      <span v-if="p.state === 'ACKNOWLEDGED'" class="text-end">
                        <AppBadge tone="success" dot>Acknowledged</AppBadge>
                        <span v-if="p.acknowledgedAt" class="mt-0.5 block text-2xs text-fg-muted">{{ formatDate(p.acknowledgedAt) }}<template v-if="p.acknowledgedVersion"> · v{{ p.acknowledgedVersion }}</template></span>
                      </span>
                      <AppBadge v-else>For reference</AppBadge>
                      <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
                    </template>
                  </RouterLink>
                </li>
              </ul>
            </div>
            <AppEmptyState v-if="!groups.length" compact :icon="ScrollText" title="Nothing here" description="No policies match these filters.">
              <AppButton size="sm" variant="secondary" @click="clearFilters">Show all policies</AppButton>
            </AppEmptyState>
          </section>
        </div>

        <aside class="space-y-4">
          <AppCard title="How acknowledgement works" :icon="BookOpenCheck">
            <ol class="relative space-y-3 border-s border-line ps-4 text-sm">
              <li v-for="(step, i) in HOW" :key="step.title" class="relative">
                <span class="absolute top-0 -start-[25px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-600 text-2xs font-semibold text-white">{{ i + 1 }}</span>
                <p class="font-medium text-fg">{{ step.title }}</p>
                <p class="text-xs text-fg-muted">{{ step.text }}</p>
              </li>
            </ol>
          </AppCard>

          <AppCard title="Your record" :icon="History">
            <ul v-if="acknowledged.length" class="space-y-3 text-sm">
              <li v-for="p in acknowledged.slice(0, 5)" :key="p.id" class="flex items-start gap-3">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success-soft text-success-fg" aria-hidden="true"><FileCheck2 :size="14" /></span>
                <div class="min-w-0">
                  <p class="truncate font-medium text-fg">{{ p.title }}</p>
                  <p class="text-xs text-fg-muted">Version {{ p.acknowledgedVersion ?? p.version.version }}<template v-if="p.acknowledgedAt"> · {{ formatDate(p.acknowledgedAt) }}</template></p>
                </div>
              </li>
            </ul>
            <p v-else class="text-sm text-fg-muted">Policies you acknowledge are listed here with the version and date.</p>
          </AppCard>
        </aside>
      </div>
    </template>
  </div>
</template>
