<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowRight, Briefcase, Building2, CalendarClock, Clock, GraduationCap, MapPin, SearchX, Sparkles, Users } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { careersApi } from '@/modules/recruitment/api/recruitment.api';
import CareersShell from '@/modules/recruitment/components/CareersShell.vue';
import type { PublicJob } from '@/modules/recruitment/types';
import { experience } from '@/modules/recruitment/utils/recruitment-format';
import { AppButton, AppEmptyState, AppErrorState, AppSearchInput } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { timeAgo } from '@/shared/utils/format';
import { careersPlace, jobFlags } from '@/modules/recruitment/utils/careers';

/** Public careers page of an organization (no sign-in): every open public job, searchable and grouped by team. */
const route = useRoute();
const slug = computed(() => String(route.params.slug));
const page = useAsync(() => careersApi.page(slug.value));
const org = computed(() => page.data.value?.organization ?? null);
const jobs = computed(() => page.data.value?.jobs ?? []);

const search = ref('');
const team = ref<string | null>(null);
const place = ref<string | null>(null);

const count = <K extends string>(keyOf: (j: PublicJob) => K | null) => {
  const m = new Map<K, number>();
  for (const j of jobs.value) {
    const k = keyOf(j);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([label, n]) => ({ label, n }));
};
const teams = computed(() => count((j) => j.department?.name ?? null));
const places = computed(() => count((j) => j.location?.name ?? null));

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return jobs.value.filter(
    (j) =>
      (!team.value || j.department?.name === team.value) &&
      (!place.value || j.location?.name === place.value) &&
      (!q || [j.title, j.department?.name, j.location?.name, EMPLOYMENT_TYPE_LABELS[j.employmentType]].some((v) => v?.toLowerCase().includes(q))),
  );
});
/** Jobs by team, teams alphabetically; jobs without a team last. */
const groups = computed(() => {
  const m = new Map<string, PublicJob[]>();
  for (const j of visible.value) {
    const k = j.department?.name ?? 'Other roles';
    m.set(k, [...(m.get(k) ?? []), j]);
  }
  return [...m].sort((a, b) => (a[0] === 'Other roles' ? 1 : b[0] === 'Other roles' ? -1 : a[0].localeCompare(b[0])));
});
const filtered = computed(() => !!search.value.trim() || !!team.value || !!place.value);
function clear() {
  search.value = '';
  team.value = null;
  place.value = null;
}

const facts = computed(() => {
  const o = org.value;
  if (!o) return [];
  return [
    o.industry && { icon: Building2, text: o.industry },
    o.companySize && { icon: Users, text: `${o.companySize} people` },
    careersPlace(o, appLocale()) && { icon: MapPin, text: careersPlace(o, appLocale())! },
  ].filter(Boolean) as { icon: typeof Building2; text: string }[];
});
const chip = (active: boolean) =>
  [
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none',
    active ? 'border-brand-600 bg-brand-600 text-white shadow-xs' : 'border-line bg-surface text-fg-muted hover:border-brand-300 hover:text-fg',
  ].join(' ');
</script>

<template>
  <CareersShell :organization="org" :slug="slug">
    <div v-if="page.loading.value && !page.data.value" class="mx-auto max-w-6xl space-y-4 px-4 py-12 sm:px-6" aria-busy="true" aria-label="Loading open positions">
      <div class="skeleton h-10 w-2/3 rounded-xl" />
      <div class="skeleton h-5 w-1/3 rounded-full" />
      <div v-for="i in 4" :key="i" class="skeleton h-24 rounded-2xl" />
    </div>
    <div v-else-if="page.error.value" class="mx-auto max-w-3xl px-4 py-16">
      <AppErrorState :error="page.error.value" title="This careers page isn't available" @retry="page.run" />
    </div>
    <template v-else-if="org">
      <!-- Hero -->
      <section class="relative overflow-hidden border-b border-line/70">
        <div
          class="absolute inset-0"
          aria-hidden="true"
          style="
            background-image:
              radial-gradient(60% 120% at 100% 0%, color-mix(in oklab, var(--brand-500) 22%, transparent), transparent 70%),
              radial-gradient(50% 100% at 0% 100%, color-mix(in oklab, var(--status-info) 12%, transparent), transparent 70%),
              linear-gradient(180deg, color-mix(in oklab, var(--brand-500) 6%, var(--app-surface)), var(--app-canvas));
          "
        />
        <div class="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <p class="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-surface/80 px-3 py-1 text-xs font-semibold text-accent-fg shadow-xs dark:border-brand-800">
            <span class="relative flex h-2 w-2" aria-hidden="true">
              <span v-if="jobs.length" class="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60 motion-reduce:hidden" />
              <span class="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
            {{ jobs.length ? `We're hiring · ${jobs.length} open ${jobs.length === 1 ? 'position' : 'positions'}` : 'Careers' }}
          </p>
          <h1 class="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance text-fg sm:text-5xl">Build your career at {{ org.name }}</h1>
          <p class="mt-4 max-w-2xl text-base leading-7 text-fg-muted">
            Find a role where your work matters. Every application is read by the hiring team, and you'll hear from us about next steps.
          </p>
          <ul v-if="facts.length" class="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted">
            <li v-for="f in facts" :key="f.text" class="inline-flex items-center gap-2"><component :is="f.icon" :size="15" class="text-brand-500" aria-hidden="true" />{{ f.text }}</li>
          </ul>
        </div>
      </section>

      <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <AppEmptyState v-if="!jobs.length" class="card py-12" :icon="Briefcase" title="No open positions right now" description="New roles are posted here first. Please check back soon." />
        <template v-else>
          <!-- Filters -->
          <div class="space-y-4">
            <AppSearchInput v-model="search" class="max-w-xl" placeholder="Search by role, team or location" aria-label="Search open positions" />
            <div v-if="teams.length > 1" class="flex flex-wrap gap-2" role="group" aria-label="Filter by team">
              <button type="button" :class="chip(!team)" :aria-pressed="!team" @click="team = null">All teams <span class="opacity-70">{{ jobs.length }}</span></button>
              <button v-for="t in teams" :key="t.label" type="button" :class="chip(team === t.label)" :aria-pressed="team === t.label" @click="team = team === t.label ? null : t.label">
                {{ t.label }} <span class="opacity-70">{{ t.n }}</span>
              </button>
            </div>
            <div v-if="places.length > 1" class="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by location">
              <MapPin :size="14" class="text-fg-subtle" aria-hidden="true" />
              <button v-for="p in places" :key="p.label" type="button" :class="chip(place === p.label)" :aria-pressed="place === p.label" @click="place = place === p.label ? null : p.label">
                {{ p.label }} <span class="opacity-70">{{ p.n }}</span>
              </button>
            </div>
          </div>

          <p class="mt-6 text-sm text-fg-muted" aria-live="polite">
            {{ visible.length }} {{ visible.length === 1 ? 'position' : 'positions' }}<template v-if="filtered"> match your search</template>
          </p>

          <AppEmptyState v-if="!visible.length" class="card mt-4 py-10" :icon="SearchX" title="No positions match" description="Try another search or clear the filters.">
            <AppButton variant="secondary" @click="clear">Clear filters</AppButton>
          </AppEmptyState>

          <section v-for="[name, list] in groups" :key="name" class="mt-8" :aria-labelledby="`team-${name}`">
            <h2 :id="`team-${name}`" class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
              {{ name }} <span class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs text-fg-muted">{{ list.length }}</span>
            </h2>
            <ul class="grid gap-3">
              <li v-for="j in list" :key="j.id">
                <RouterLink
                  :to="`/careers/${slug}/jobs/${j.id}`"
                  class="group card flex items-center gap-4 p-5 transition hover:-translate-y-px hover:border-brand-300 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none motion-reduce:hover:translate-y-0"
                >
                  <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-fg max-sm:hidden" aria-hidden="true"><Briefcase :size="19" /></span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="text-base font-semibold text-fg transition group-hover:text-accent-fg">{{ j.title }}</h3>
                      <span v-for="f in jobFlags(j)" :key="f.label" :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold', f.class]">
                        <component :is="f.label === 'New' ? Sparkles : CalendarClock" :size="11" aria-hidden="true" />{{ f.label }}
                      </span>
                    </div>
                    <p class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                      <span v-if="j.location" class="inline-flex items-center gap-1.5"><MapPin :size="14" class="text-fg-subtle" aria-hidden="true" />{{ j.location.name }}</span>
                      <span class="inline-flex items-center gap-1.5"><Clock :size="14" class="text-fg-subtle" aria-hidden="true" />{{ EMPLOYMENT_TYPE_LABELS[j.employmentType] }}</span>
                      <span v-if="experience(j.experienceMin, j.experienceMax)" class="inline-flex items-center gap-1.5">
                        <GraduationCap :size="14" class="text-fg-subtle" aria-hidden="true" />{{ experience(j.experienceMin, j.experienceMax) }}
                      </span>
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-4">
                    <span v-if="j.postedAt" class="text-xs text-fg-subtle max-md:hidden">Posted {{ timeAgo(j.postedAt) }}</span>
                    <span class="grid h-9 w-9 place-items-center rounded-full border border-line text-fg-muted transition group-hover:border-brand-600 group-hover:bg-brand-600 group-hover:text-white" aria-hidden="true">
                      <ArrowRight :size="16" />
                    </span>
                  </div>
                </RouterLink>
              </li>
            </ul>
          </section>
        </template>
      </div>
    </template>
  </CareersShell>
</template>
