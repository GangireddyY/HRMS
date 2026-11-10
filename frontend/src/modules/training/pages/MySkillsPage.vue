<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowDown, ArrowRight, BadgeCheck, Check, CircleDashed, Clock, Flag, GraduationCap, Info, Plus, ShieldCheck, Sparkles, Target, Trash2, TriangleAlert } from '@lucide/vue';
import { SKILL_LEVEL_LABELS, type SkillCategory } from '@contracts';
import { SKILL_CATEGORY_LABELS, skillsApi } from '@/modules/training/api/skills.api';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import type { SkillProfile } from '@/modules/training/types';
import { CATEGORY_VISUALS } from '@/modules/training/utils/skill-visuals';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSegmented, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

type MySkill = SkillProfile['skills'][number];

/** My skills: own ratings, verified levels, what my role needs and the courses that close the gaps. */
const feedback = useFeedbackStore();
const profile = useAsync(() => skillsApi.mine());
const catalog = useAsync(() => skillsApi.list());
const p = computed(() => profile.data.value);
const busy = ref<string | null>(null);
async function rate(skillId: string, level: number) {
  busy.value = skillId;
  try {
    profile.data.value = await skillsApi.setMine({ skillId, level });
  } catch (e) {
    feedback.error('Could not save the level', e);
  } finally {
    busy.value = null;
  }
}
async function remove(s: MySkill) {
  if (!(await feedback.confirm({ title: `Remove ${s.name}?`, message: s.verifiedLevel ? 'Your own rating is removed; the verified level stays.' : 'It is removed from your skills.', confirmLabel: 'Remove' }))) return;
  try {
    profile.data.value = await skillsApi.removeMine(s.skillId);
  } catch (e) {
    feedback.error('Could not remove it', e);
  }
}
const adding = ref(false);
const draft = ref<{ skillId: string | null; level: number; notes: string }>({ skillId: null, level: 3, notes: '' });
const addable = computed(() => (catalog.data.value ?? []).filter((s) => !p.value?.skills.some((x) => x.skillId === s.id && x.level)).map((s) => ({ value: s.id, label: s.name, description: SKILL_CATEGORY_LABELS[s.category] })));
async function add() {
  busy.value = 'add';
  try {
    profile.data.value = await skillsApi.setMine({ skillId: draft.value.skillId!, level: draft.value.level, notes: draft.value.notes || null });
    feedback.success('Skill added');
    adding.value = false;
  } catch (e) {
    feedback.error('Could not add the skill', e);
  } finally {
    busy.value = null;
  }
}
function openAdd(skillId: string | null = null) {
  draft.value = { skillId, level: 3, notes: '' };
  adding.value = true;
}
const draftRequired = computed(() => (draft.value.skillId ? (p.value?.requirements.find((r) => r.skillId === draft.value.skillId)?.requiredLevel ?? null) : null));

// ---- Summary ---------------------------------------------------------------------------------------------------
const lower = (n: number) => SKILL_LEVEL_LABELS[n]!.toLowerCase();
const met = computed(() => p.value?.requirements.filter((r) => r.current >= r.requiredLevel).length ?? 0);
const verifiedCount = computed(() => p.value?.skills.filter((s) => s.verifiedLevel).length ?? 0);
const selfRated = (s: MySkill) => !!s.level;
/** Skills the role needs that aren't on the profile at all. */
const missing = computed(() => (p.value ? p.value.requirements.filter((r) => !p.value!.skills.some((s) => s.skillId === r.skillId)) : []));
const biggestGap = computed(() => (p.value ? ([...p.value.gaps].sort((a, b) => b.gap - a.gap)[0] ?? null) : null));
const onProfile = (skillId: string) => !!p.value?.skills.some((s) => s.skillId === skillId && s.level);
const headline = computed(() => {
  const v = p.value;
  if (!v) return { title: '', text: '' };
  if (!v.designation) return { title: 'Build your skills profile', text: 'Add the skills you use at work. Once you have a role, you can see how you measure up to it.' };
  if (!v.requirements.length) return { title: 'Build your skills profile', text: `No skills have been set for ${v.designation.name} yet. Keep your profile current so your manager can plan your growth.` };
  if (!v.gaps.length) return { title: `You're ready for your role`, text: `You meet every skill ${v.designation.name} needs. Keep going — the next level is yours.` };
  return {
    title: v.readiness ? `You're ${v.readiness}% ready for your role` : `Let's build the skills your role needs`,
    text: `${met.value} of ${v.requirements.length} skills ${v.designation.name} needs are at the level required. Close ${v.gaps.length === 1 ? 'one gap' : `${v.gaps.length} gaps`} to be fully ready.`,
  };
});
const stats = computed(() => {
  const v = p.value;
  if (!v) return [];
  return [
    { key: 'skills', label: 'Skills on your profile', value: v.skills.length, hint: `${v.skills.filter(selfRated).length} rated by you`, icon: Sparkles, tone: 'text-accent-fg bg-accent-soft' },
    { key: 'verified', label: 'Verified', value: verifiedCount.value, hint: 'By your manager or a course', icon: ShieldCheck, tone: verifiedCount.value ? 'text-success-fg bg-success-soft' : 'text-fg-muted bg-surface-muted' },
    { key: 'met', label: 'Role skills met', value: v.requirements.length ? `${met.value}/${v.requirements.length}` : '—', hint: v.designation?.name ?? 'No designation yet', icon: Target, tone: 'text-info-fg bg-info-soft' },
    { key: 'gaps', label: 'Gaps to close', value: v.gaps.length, hint: v.gaps.some((g) => g.gap >= 2) ? `${v.gaps.filter((g) => g.gap >= 2).length} of them 2+ levels short` : v.gaps.length ? 'One level short' : 'Nothing to close', icon: TriangleAlert, tone: v.gaps.length ? 'text-warning-fg bg-warning-soft' : 'text-success-fg bg-success-soft' },
  ];
});
const CIRC = 2 * Math.PI * 42;

// ---- List ------------------------------------------------------------------------------------------------------
const filter = ref<'all' | 'role' | 'verified'>('all');
const filterOptions = computed(() => [
  { value: 'all' as const, label: `All ${p.value?.skills.length ?? ''}`.trim() },
  { value: 'role' as const, label: `For your role ${p.value?.skills.filter((s) => s.required).length ?? ''}`.trim() },
  { value: 'verified' as const, label: `Verified ${verifiedCount.value}` },
]);
const CATEGORY_ORDER = Object.keys(SKILL_CATEGORY_LABELS) as SkillCategory[];
const groups = computed(() => {
  const list = (p.value?.skills ?? []).filter((s) => filter.value === 'all' || (filter.value === 'role' ? !!s.required : !!s.verifiedLevel));
  return CATEGORY_ORDER.map((c) => ({ category: c, items: list.filter((s) => (s.category ?? 'OTHER') === c) })).filter((g) => g.items.length);
});
function status(s: MySkill) {
  if (!s.required) return null;
  const gap = s.required - s.effectiveLevel;
  if (gap <= 0) return { tone: 'success' as const, text: 'Meets your role' };
  return { tone: gap >= 2 ? ('danger' as const) : ('warning' as const), text: `${gap} level${gap === 1 ? '' : 's'} short` };
}
/** Scrolls to a section and briefly highlights it. */
function jump(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('ring-2', 'ring-brand-500');
  setTimeout(() => el.classList.remove('ring-2', 'ring-brand-500'), 1600);
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My skills" description="Rate your skills, see what your role needs, and find courses that close the gaps. Verified levels come from your manager or completed courses.">
      <template #actions><AppButton :icon="Plus" :disabled="!p" @click="openAdd()">Add a skill</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="profile.loading.value && !p" :lines="6" />
    <AppErrorState v-else-if="profile.error.value" :error="profile.error.value" @retry="profile.run" />
    <AppAlert v-else-if="!p" tone="info">Your account isn't linked to an employee record yet.</AppAlert>
    <template v-else>
      <!-- Profile summary -->
      <section class="card overflow-hidden">
        <div class="relative flex flex-wrap items-center gap-6 hero-soft px-6 py-6 text-fg">
          <div class="relative min-w-0 flex-1 basis-72">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-2.5 py-0.5 text-xs font-medium ring-1 ring-line/70">
              <Target :size="13" aria-hidden="true" />{{ p.designation ? p.designation.name : 'Skills profile' }}
            </p>
            <h2 class="mt-3 text-2xl font-semibold tracking-tight">{{ headline.title }}</h2>
            <p class="mt-1 max-w-2xl text-sm text-fg-muted">{{ headline.text }}</p>
            <p class="mt-3 text-xs text-fg-muted">{{ p.employee.name }} · <span class="font-mono">{{ p.employee.employeeCode }}</span></p>
          </div>
          <div v-if="p.requirements.length" class="relative flex items-center gap-4">
            <div class="relative h-28 w-28" role="progressbar" :aria-valuenow="p.readiness" aria-valuemin="0" aria-valuemax="100" aria-label="Role readiness">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-fg/10" />
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" class="stroke-brand-600 dark:stroke-brand-400 transition-[stroke-dashoffset] duration-700" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - p.readiness / 100)" />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-2xl font-semibold tabular-nums">{{ p.readiness }}%</span>
                <span class="text-2xs text-fg-muted">role ready</span>
              </div>
            </div>
            <p class="text-sm text-fg-muted"><span class="block text-2xl font-semibold text-fg tabular-nums">{{ met }}<span class="text-base font-normal text-fg-subtle">/{{ p.requirements.length }}</span></span>skills met</p>
          </div>
        </div>
        <ul class="grid gap-px bg-line/70 sm:grid-cols-2 xl:grid-cols-4">
          <li v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-5 py-3.5">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
            <div class="min-w-0">
              <p class="text-xl leading-6 font-semibold text-fg tabular-nums">{{ s.value }}</p>
              <p class="text-xs text-fg-muted">{{ s.label }}</p>
              <p class="truncate text-2xs text-fg-subtle" :title="s.hint">{{ s.hint }}</p>
            </div>
          </li>
        </ul>
        <div v-if="biggestGap" class="flex flex-wrap items-center gap-3 border-t border-line/70 bg-accent-soft/40 px-5 py-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white" aria-hidden="true"><Flag :size="15" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-2xs font-semibold tracking-wide text-accent-fg uppercase">Next step</p>
            <p class="text-sm font-medium text-fg sm:truncate">
              <template v-if="biggestGap.current">Grow {{ biggestGap.name }} from {{ lower(biggestGap.current) }} to {{ lower(biggestGap.required) }}</template>
              <template v-else>Rate yourself in {{ biggestGap.name }} — your role needs {{ lower(biggestGap.required) }}</template>
              <span class="ms-1 text-xs font-normal text-fg-muted">· {{ biggestGap.courses.length ? `${biggestGap.courses.length} course${biggestGap.courses.length === 1 ? '' : 's'} can help` : 'no course for it yet' }}</span>
            </p>
          </div>
          <AppButton v-if="!onProfile(biggestGap.skillId)" size="sm" variant="secondary" :icon="Plus" @click="openAdd(biggestGap.skillId)">Rate yourself</AppButton>
          <AppButton size="sm" :icon-right="ArrowRight" @click="jump('close-gaps')">See how to close it</AppButton>
        </div>
        <div v-else-if="p.requirements.length" class="flex items-center gap-3 border-t border-line/70 bg-success-soft/50 px-5 py-3 text-sm text-success-fg">
          <Check :size="16" aria-hidden="true" />You meet every skill your role needs. Ask your manager to verify your levels so they count on record.
        </div>
      </section>

      <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <!-- Skills -->
        <section class="card">
          <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Sparkles :size="16" /></span>
              <div>
                <h2 class="text-sm font-semibold text-fg">Your skills</h2>
                <p class="text-xs text-fg-muted">Select a segment to change your own rating. A verified level counts over your own.</p>
              </div>
            </div>
            <AppSegmented v-if="p.skills.length" v-model="filter" class="w-full sm:w-auto" size="sm" :options="filterOptions" label="Show skills" />
          </header>

          <AppEmptyState v-if="!p.skills.length && !missing.length" :icon="Sparkles" title="No skills yet" description="Add the skills you use at work and rate yourself. Your manager can then verify them.">
            <AppButton :icon="Plus" @click="openAdd()">Add your first skill</AppButton>
          </AppEmptyState>
          <template v-else>
            <AppEmptyState v-if="!groups.length && p.skills.length" compact :icon="Sparkles" title="Nothing here" :description="filter === 'verified' ? 'None of your skills is verified yet. Ask your manager, or complete a course that teaches one.' : 'None of your skills is one your role needs.'">
              <AppButton size="sm" variant="secondary" @click="filter = 'all'">Show all skills</AppButton>
            </AppEmptyState>
            <div v-for="g in groups" :key="g.category">
              <h3 class="flex items-center gap-2 border-b border-line/60 bg-surface-muted/50 px-4 py-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                <span :class="['h-2 w-2 rounded-full', CATEGORY_VISUALS[g.category].dot]" aria-hidden="true" />{{ SKILL_CATEGORY_LABELS[g.category] }}
                <span class="font-normal tabular-nums">{{ g.items.length }}</span>
              </h3>
              <ul class="divide-y divide-line/70">
                <li v-for="s in g.items" :key="s.skillId" :class="['flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-opacity', busy === s.skillId && 'opacity-60']">
                  <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CATEGORY_VISUALS[s.category ?? 'OTHER'].tile]" aria-hidden="true">
                    <component :is="CATEGORY_VISUALS[s.category ?? 'OTHER'].icon" :size="17" />
                  </span>
                  <div class="min-w-0 flex-1 basis-48">
                    <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-fg">
                      {{ s.name }}
                      <AppBadge v-if="s.verifiedLevel" size="sm" tone="success"><BadgeCheck :size="12" aria-hidden="true" />Verified {{ lower(s.verifiedLevel) }}</AppBadge>
                    </p>
                    <p class="mt-0.5 text-xs text-fg-muted">
                      <template v-if="s.verifiedLevel">{{ s.verifiedSource === 'TRAINING' ? 'Verified by a course' : `Verified by ${s.verifiedBy}` }}<template v-if="s.verifiedAt">, {{ formatDate(s.verifiedAt) }}</template></template>
                      <template v-else>{{ s.level ? 'Self-rated · not verified yet' : 'Not rated by you' }}</template>
                      <template v-if="s.notes"> · {{ s.notes }}</template>
                    </p>
                  </div>
                  <div class="w-36 shrink-0">
                    <template v-if="status(s)">
                      <span
                        :class="[
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                          status(s)!.tone === 'success' ? 'bg-success-soft text-success-fg' : status(s)!.tone === 'danger' ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg',
                        ]"
                      >
                        <component :is="status(s)!.tone === 'success' ? Check : ArrowDown" :size="12" aria-hidden="true" />{{ status(s)!.text }}
                      </span>
                      <p class="mt-1 text-2xs text-fg-muted">Role needs {{ lower(s.required!) }}</p>
                    </template>
                    <p v-else class="text-2xs text-fg-subtle">Not needed for your role</p>
                  </div>
                  <div class="flex items-center gap-3">
                    <div>
                      <SkillLevel :model-value="s.level" editable :label="`Your level in ${s.name}`" :required="s.required" @update:model-value="(v: number) => rate(s.skillId, v)" />
                      <p class="mt-1 text-2xs text-fg-muted">Your rating · <span class="font-medium text-fg">{{ s.level ? SKILL_LEVEL_LABELS[s.level] : 'Not rated' }}</span></p>
                    </div>
                    <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${s.name}`" :disabled="!s.level" @click="remove(s)" />
                  </div>
                </li>
              </ul>
            </div>

            <!-- Role skills that aren't on the profile yet -->
            <div v-if="missing.length && filter !== 'verified'">
              <h3 class="flex items-center gap-2 border-y border-line/60 bg-warning-soft/40 px-4 py-1.5 text-2xs font-semibold tracking-wide text-warning-fg uppercase">
                <CircleDashed :size="12" aria-hidden="true" />Your role needs these — not on your profile yet
              </h3>
              <ul class="divide-y divide-line/70">
                <li v-for="r in missing" :key="r.skillId" class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-line-strong text-fg-subtle" aria-hidden="true">
                    <component :is="CATEGORY_VISUALS[r.category ?? 'OTHER'].icon" :size="16" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-fg">{{ r.name }}</p>
                    <p class="text-xs text-fg-muted">{{ r.category ? SKILL_CATEGORY_LABELS[r.category] : 'Skill' }} · role needs {{ lower(r.requiredLevel) }}</p>
                  </div>
                  <SkillLevel :model-value="0" :required="r.requiredLevel" size="sm" :label="r.name" />
                  <AppButton size="sm" variant="secondary" :icon="Plus" @click="openAdd(r.skillId)">Rate yourself</AppButton>
                </li>
              </ul>
            </div>
          </template>
        </section>

        <aside class="space-y-4">
          <!-- Role fit -->
          <AppCard :title="p.designation ? p.designation.name : 'Your role'" description="What the role needs" :icon="Target">
            <template v-if="p.requirements.length">
              <div class="mb-1 flex items-baseline justify-between text-xs text-fg-muted">
                <span>Role readiness</span>
                <span class="text-sm font-semibold text-fg tabular-nums">{{ p.readiness }}%</span>
              </div>
              <div class="mb-4 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <div :class="['h-full rounded-full transition-[width] duration-700', p.readiness >= 80 ? 'bg-success' : p.readiness >= 50 ? 'bg-warning' : 'bg-danger']" :style="{ width: `${Math.max(p.readiness, 3)}%` }" />
              </div>
              <ul class="space-y-2.5 text-sm">
                <li v-for="r in p.requirements" :key="r.skillId" class="flex items-center gap-2.5">
                  <span
                    :class="['flex h-5 w-5 shrink-0 items-center justify-center rounded-full', r.current >= r.requiredLevel ? 'bg-success-soft text-success-fg' : 'bg-warning-soft text-warning-fg']"
                    aria-hidden="true"
                  >
                    <component :is="r.current >= r.requiredLevel ? Check : ArrowDown" :size="11" :stroke-width="3" />
                  </span>
                  <span :class="['min-w-0 flex-1 truncate', r.current >= r.requiredLevel ? 'text-fg' : 'font-medium text-fg']">{{ r.name }}</span>
                  <span class="sr-only">{{ r.current >= r.requiredLevel ? 'meets the level' : 'below the level' }}</span>
                  <SkillLevel :model-value="r.current" :required="r.requiredLevel" size="sm" :label="r.name" />
                  <span class="w-8 text-end text-2xs text-fg-muted tabular-nums" aria-hidden="true">{{ r.current }}/{{ r.requiredLevel }}</span>
                </li>
              </ul>
            </template>
            <p v-else class="text-sm text-fg-muted">{{ p.designation ? 'No skills have been set for your role yet.' : 'You have no designation yet.' }}</p>
          </AppCard>

          <!-- Gaps and courses -->
          <AppCard v-if="p.gaps.length" id="close-gaps" class="scroll-mt-4 transition-shadow" title="Close the gaps" description="Courses that teach what your role needs" :icon="GraduationCap">
            <ul class="space-y-3">
              <li v-for="g in p.gaps" :key="g.skillId" class="rounded-xl p-3 ring-1 ring-line">
                <div class="flex items-start justify-between gap-2">
                  <p class="text-sm font-semibold text-fg">{{ g.name }}</p>
                  <span :class="['shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold', g.gap >= 2 ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg']">{{ g.gap }} level{{ g.gap === 1 ? '' : 's' }} short</span>
                </div>
                <p class="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
                  <span>{{ g.current ? SKILL_LEVEL_LABELS[g.current] : 'Not rated' }}</span>
                  <ArrowRight :size="12" aria-hidden="true" /><span class="sr-only">to</span>
                  <span class="font-medium text-fg">{{ SKILL_LEVEL_LABELS[g.required] }}</span>
                </p>
                <ul v-if="g.courses.length" class="mt-3 space-y-1.5">
                  <li v-for="c in g.courses" :key="c.id">
                    <RouterLink :to="`/me/training/courses/${c.id}`" class="group flex items-center gap-2.5 rounded-lg bg-surface-muted/60 px-2.5 py-2 transition hover:bg-accent-soft/60">
                      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-fg" aria-hidden="true"><GraduationCap :size="14" /></span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium text-fg group-hover:text-accent-fg">{{ c.title }}</span>
                        <span class="flex items-center gap-1 text-2xs text-fg-muted">
                          Up to {{ lower(c.teachesLevel) }}<template v-if="c.durationHours"> · <Clock :size="10" aria-hidden="true" />{{ c.durationHours }} h</template>
                        </span>
                      </span>
                      <ArrowRight :size="14" class="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-accent-fg" aria-hidden="true" />
                    </RouterLink>
                  </li>
                </ul>
                <p v-else class="mt-2 flex items-start gap-1.5 rounded-md bg-surface-muted/60 px-2.5 py-2 text-xs text-fg-muted"><Info :size="13" class="mt-px shrink-0" aria-hidden="true" />No course for this yet — talk to your manager about on-the-job practice.</p>
                <AppButton v-if="!onProfile(g.skillId)" class="mt-2" size="xs" variant="link" @click="openAdd(g.skillId)">Rate yourself</AppButton>
              </li>
            </ul>
          </AppCard>

          <!-- Level guide -->
          <AppCard title="Proficiency levels">
            <ol class="space-y-2 text-sm">
              <li v-for="n in 5" :key="n" class="flex items-center gap-3">
                <SkillLevel :model-value="n" size="sm" :label="SKILL_LEVEL_LABELS[n]" />
                <span class="text-fg"><span class="font-semibold tabular-nums">{{ n }}</span> · {{ SKILL_LEVEL_LABELS[n] }}</span>
              </li>
            </ol>
            <p class="mt-3 flex items-start gap-1.5 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">
              <BadgeCheck :size="13" class="mt-px shrink-0 text-success-fg" aria-hidden="true" />A level verified by your manager or a completed course is the one that counts towards your role.
            </p>
          </AppCard>
        </aside>
      </div>
    </template>

    <AppModal :open="adding" title="Add a skill" size="sm" @close="adding = false">
      <div class="space-y-4">
        <AppSelect v-model="draft.skillId" label="Skill" :options="addable" placeholder="Search the catalog" searchable :clearable="false" />
        <div>
          <p class="label">Your level</p>
          <div class="flex items-center gap-3">
            <SkillLevel v-model="draft.level" editable label="Your level" :required="draftRequired" />
            <span class="text-sm text-fg-muted">{{ SKILL_LEVEL_LABELS[draft.level] }}</span>
          </div>
          <p v-if="draftRequired" class="mt-1.5 text-xs text-fg-muted">Your role needs {{ lower(draftRequired) }}.</p>
        </div>
        <AppInput v-model="draft.notes" label="Notes" :maxlength="500" placeholder="Where you've used it, certifications…" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="adding = false">Cancel</AppButton>
        <AppButton :loading="busy === 'add'" :disabled="!draft.skillId" @click="add">Add</AppButton>
      </template>
    </AppModal>
  </div>
</template>
