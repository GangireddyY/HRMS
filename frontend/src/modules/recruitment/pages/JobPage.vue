<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BriefcaseBusiness, Building2, CalendarClock, CalendarDays, ChevronDown, Columns3, ExternalLink, FileText, GraduationCap, Globe, Kanban, MapPin, Pencil, Rows3, SearchX, Star, UserPlus, UserRound, Users } from '@lucide/vue';
import type { ApplicationStage, JobStatus } from '@contracts';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import CandidateFormModal from '@/modules/recruitment/components/CandidateFormModal.vue';
import JobFormModal from '@/modules/recruitment/components/JobFormModal.vue';
import JobPostingPanel from '@/modules/recruitment/components/JobPostingPanel.vue';
import PipelineCard from '@/modules/recruitment/components/PipelineCard.vue';
import type { ApplicationCard, Candidate, JobDetail } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, SOURCE_LABELS, STAGE_LABELS, experience, jobTone, stageAccent, stageTone } from '@/modules/recruitment/utils/recruitment-format';
import { SOURCE_ICON, STAGE_ICON, ageClass, daysUntil, dueText, shortDay, stageAge, stageSoft, timeOfDay } from '@/modules/recruitment/utils/recruitment-ui';
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppDataTable,
  AppDropdown,
  AppEmptyState,
  AppErrorState,
  AppMenuItem,
  AppPageHeader,
  AppSearchInput,
  AppSegmented,
  AppSkeleton,
  AppStatStrip,
  AppSwitch,
  AppTabs,
  type StripItem,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** A job's hiring pipeline: stage columns of candidate cards (or a list), what needs attention, and the posting itself. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('recruitment.manage'));
const id = computed(() => String(route.params.id));
const job = useAsync(() => recruitmentApi.job(id.value));
const apps = useAsync(() => fetchAllPages((page, pageSize) => recruitmentApi.applications({ jobId: id.value, page, pageSize })));
watch(id, () => {
  void job.run();
  void apps.run();
});

const ACTIVE: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const CLOSED: ApplicationStage[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];
const items = computed(() => apps.data.value ?? []);
const showClosed = ref(false);

// ---- Focus: the strip figures narrow the board ------------------------------------------------------------------
type Focus = 'active' | 'interviews' | 'attention' | 'offer' | 'hired';
const focus = ref<Focus | null>(null);
const isActive = (a: ApplicationCard) => ACTIVE.includes(a.stage);
const now = Date.now();
// `nextInterviewAt` is the earliest interview still marked scheduled, so it can be in the past (held, not wrapped up).
const upcoming = (a: ApplicationCard) => !!a.nextInterviewAt && new Date(a.nextInterviewAt).getTime() > now;
const heldNotClosed = (a: ApplicationCard) => !!a.nextInterviewAt && new Date(a.nextInterviewAt).getTime() <= now;
/** Feedback is expected within a day of the interview. */
const feedbackLate = (a: ApplicationCard) => !!a.nextInterviewAt && now - new Date(a.nextInterviewAt).getTime() > 24 * 3_600_000;
const stalled = (a: ApplicationCard) => isActive(a) && (stageAge(a.stageChangedAt).tone !== 'fresh' || feedbackLate(a));
const FOCUS: Record<Focus, (a: ApplicationCard) => boolean> = {
  active: isActive,
  interviews: (a) => !!a.nextInterviewAt,
  attention: stalled,
  offer: (a) => a.stage === 'OFFER',
  hired: (a) => a.stage === 'HIRED',
};
const strip = computed<StripItem[]>(() => {
  const j = job.data.value;
  const act = items.value.filter(isActive);
  const next = items.value.filter(upcoming).sort((a, b) => a.nextInterviewAt!.localeCompare(b.nextInterviewAt!));
  const held = items.value.filter(heldNotClosed).length;
  const stuck = act.filter(stalled);
  const hired = items.value.filter((a) => a.stage === 'HIRED').length;
  const seats = j ? Math.max(0, j.requisition.openings - j.requisition.hiredCount) : 0;
  return [
    { key: 'active', label: 'In pipeline', value: act.length, tone: 'brand', hint: `${act.filter((a) => a.stage === 'APPLIED').length} new to review` },
    {
      key: 'interviews',
      label: 'Interviews',
      value: next.length + held,
      tone: 'violet',
      hint: held ? `${held} awaiting feedback` : next[0] ? `Next ${shortDay(next[0].nextInterviewAt!)}, ${timeOfDay(next[0].nextInterviewAt!)}` : 'Nothing scheduled',
    },
    { key: 'attention', label: 'Needs attention', value: stuck.length, tone: stuck.length ? 'danger' : 'neutral', hint: stuck.length ? 'A week in one stage, or feedback overdue' : 'Everyone is moving' },
    { key: 'offer', label: 'At offer', value: act.filter((a) => a.stage === 'OFFER').length, tone: 'warning', hint: 'Drafted, released or accepted' },
    { key: 'hired', label: 'Hired', value: j ? `${j.requisition.hiredCount}/${j.requisition.openings}` : hired, tone: 'success', hint: seats ? `${seats} seat${seats === 1 ? '' : 's'} left to fill` : 'All seats filled' },
  ];
});
watch(focus, (f) => f === 'hired' && (showClosed.value = true));

// ---- Board / list -----------------------------------------------------------------------------------------------
const LAYOUT_KEY = 'hrms.recruitment.pipeline.layout';
const layout = ref<'board' | 'list'>(localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'board');
watch(layout, (v) => localStorage.setItem(LAYOUT_KEY, v));
const layoutOptions = [
  { value: 'board' as const, label: 'Board', icon: Columns3 },
  { value: 'list' as const, label: 'List', icon: Rows3 },
];
const search = ref('');
const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter(
    (a) =>
      (!focus.value || FOCUS[focus.value](a)) &&
      (!q || [a.candidate.name, a.candidate.email, a.candidate.currentTitle, a.candidate.currentCompany].some((v) => v?.toLowerCase().includes(q))),
  );
});
const byStage = computed(() => {
  const m = new Map<ApplicationStage, ApplicationCard[]>();
  for (const a of visible.value) m.set(a.stage, [...(m.get(a.stage) ?? []), a]);
  return m;
});
const closedCount = computed(() => items.value.filter((a) => CLOSED.includes(a.stage)).length);
const columnsShown = computed(() => [...ACTIVE, ...(showClosed.value ? CLOSED : [])]);
const listRows = computed(() => visible.value.filter((a) => showClosed.value || isActive(a)));
const listColumns: TableColumn<ApplicationCard>[] = [
  { key: 'candidate', label: 'Candidate' },
  { key: 'stage', label: 'Stage' },
  { key: 'source', label: 'Source' },
  { key: 'experience', label: 'Experience', align: 'right' },
  { key: 'rating', label: 'Rating' },
  { key: 'next', label: 'Next interview' },
  { key: 'age', label: 'In stage', align: 'right' },
];
const narrowed = computed(() => !!focus.value || !!search.value.trim());
function clearNarrowing() {
  focus.value = null;
  search.value = '';
}
const open = (a: ApplicationCard) => router.push(`/hr/recruitment/applications/${a.id}`);

// ---- Job status and editing -------------------------------------------------------------------------------------
const STATUS_ACTIONS: Record<JobStatus, { to: JobStatus; label: string }[]> = {
  DRAFT: [{ to: 'OPEN', label: 'Open for applications' }, { to: 'CLOSED', label: 'Close' }],
  OPEN: [{ to: 'ON_HOLD', label: 'Put on hold' }, { to: 'CLOSED', label: 'Close' }],
  ON_HOLD: [{ to: 'OPEN', label: 'Reopen' }, { to: 'CLOSED', label: 'Close' }],
  CLOSED: [{ to: 'OPEN', label: 'Reopen' }],
};
async function setStatus(to: JobStatus) {
  try {
    job.data.value = await recruitmentApi.setJobStatus(id.value, to);
    feedback.success(`Job ${JOB_STATUS_LABELS[to].toLowerCase()}`);
  } catch (e) {
    feedback.error('Could not change the job status', e);
  }
}

const editOpen = ref(false);
function onEdited(j: JobDetail) {
  editOpen.value = false;
  job.data.value = j;
  feedback.success('Job updated');
}

const addOpen = ref(false);
async function onCandidateAdded(c: Candidate) {
  addOpen.value = false;
  feedback.success(`${c.name} added`);
  await apps.run();
}
async function addExisting(candidateId: string) {
  addOpen.value = false;
  try {
    await recruitmentApi.addToJob(id.value, candidateId);
    feedback.success('Candidate added to this job');
    await apps.run();
  } catch (e) {
    feedback.error('Could not add the candidate', e);
  }
}

// ---- Header facts and posting -------------------------------------------------------------------------------------
const tab = ref<'pipeline' | 'posting'>('pipeline');
const tabs = computed(() => [
  { key: 'pipeline', label: 'Pipeline', icon: Kanban, count: items.value.filter(isActive).length },
  { key: 'posting', label: 'Job posting', icon: FileText },
]);
const facts = computed(() => {
  const j = job.data.value;
  if (!j) return [];
  return [
    { label: 'Department', value: j.requisition.department?.name, icon: Building2 },
    { label: 'Location', value: j.requisition.location?.name, icon: MapPin },
    { label: 'Type', value: EMPLOYMENT_TYPE_LABELS[j.requisition.employmentType], icon: UserRound },
    { label: 'Experience', value: experience(j.experienceMin, j.experienceMax), icon: GraduationCap },
    { label: 'Opened', value: j.openedAt ? `${formatDate(j.openedAt)} · ${timeAgo(j.openedAt)}` : 'Not opened yet', icon: CalendarDays },
  ].filter((f) => f.value);
});
const closing = computed(() => {
  const d = job.data.value?.closesOn;
  if (!d || job.data.value?.status === 'CLOSED') return null;
  const n = daysUntil(d);
  return { text: n < 0 ? `Closing date passed (${formatDate(d)})` : `Closes ${dueText(d).toLowerCase()} · ${formatDate(d)}`, tone: n < 0 ? 'text-danger-fg' : n <= 7 ? 'text-warning-fg' : 'text-fg-muted' };
});
const publicUrl = computed(() => (job.data.value?.isPublic && auth.organization?.slug ? `/careers/${auth.organization.slug}/jobs/${job.data.value.id}` : null));
const hiredPct = computed(() => {
  const r = job.data.value?.requisition;
  return r ? Math.round((r.hiredCount / Math.max(1, r.openings)) * 100) : 0;
});
</script>

<template>
  <div class="space-y-4">
    <AppSkeleton v-if="job.loading.value && !job.data.value" :lines="6" />
    <AppErrorState v-else-if="job.error.value" :error="job.error.value" title="Could not load the job" @retry="job.run" />
    <template v-else-if="job.data.value">
      <AppPageHeader :title="job.data.value.title" back="/hr/recruitment/jobs" back-label="Jobs">
        <template #leading>
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true">
            <BriefcaseBusiness :size="22" />
          </span>
        </template>
        <template #badges>
          <AppBadge :tone="jobTone[job.data.value.status]" dot>{{ JOB_STATUS_LABELS[job.data.value.status] }}</AppBadge>
          <AppBadge v-if="job.data.value.isPublic" tone="info"><Globe :size="11" aria-hidden="true" />On careers page</AppBadge>
          <AppBadge><span class="font-mono">{{ job.data.value.requisition.code }}</span></AppBadge>
        </template>
        <template v-if="canManage" #actions>
          <AppButton variant="secondary" :icon="Pencil" @click="editOpen = true">Edit posting</AppButton>
          <AppDropdown label="Job status" width="w-56">
            <template #trigger="{ toggle }"><AppButton variant="secondary" :icon-right="ChevronDown" @click="toggle">Status</AppButton></template>
            <template #default="{ close }">
              <AppMenuItem v-for="a in STATUS_ACTIONS[job.data.value.status]" :key="a.to" @select="close(); setStatus(a.to)">{{ a.label }}</AppMenuItem>
            </template>
          </AppDropdown>
          <AppButton :icon="UserPlus" :disabled="job.data.value.status !== 'OPEN'" :title="job.data.value.status !== 'OPEN' ? 'Open the job to add candidates' : undefined" @click="addOpen = true">Add candidate</AppButton>
        </template>
      </AppPageHeader>

      <!-- Key facts -->
      <section class="card flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3" aria-label="About this job">
        <div v-if="job.data.value.requisition.hiringManager" class="flex items-center gap-2.5">
          <AppAvatar :name="job.data.value.requisition.hiringManager.name" size="sm" />
          <div class="min-w-0">
            <p class="text-2xs text-fg-muted">Hiring manager</p>
            <p class="truncate text-sm font-medium text-fg">{{ job.data.value.requisition.hiringManager.name }}</p>
          </div>
        </div>
        <span v-if="job.data.value.requisition.hiringManager" class="hidden h-8 w-px bg-line sm:block" aria-hidden="true" />
        <ul class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
          <li v-for="f in facts" :key="f.label" class="inline-flex items-center gap-1.5" :title="f.label"><component :is="f.icon" :size="13" aria-hidden="true" /><span class="sr-only">{{ f.label }}: </span>{{ f.value }}</li>
          <li v-if="closing" :class="['inline-flex items-center gap-1.5 font-medium', closing.tone]"><CalendarClock :size="13" aria-hidden="true" />{{ closing.text }}</li>
        </ul>
        <div class="ms-auto flex min-w-44 items-center gap-3">
          <div class="flex-1">
            <div class="mb-1 flex justify-between text-2xs text-fg-muted"><span>Openings filled</span><span class="font-semibold text-fg tabular-nums">{{ job.data.value.requisition.hiredCount }} of {{ job.data.value.requisition.openings }}</span></div>
            <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="hiredPct" aria-valuemin="0" aria-valuemax="100" aria-label="Openings filled">
              <div class="h-full rounded-full bg-success transition-[width] duration-700" :style="{ width: `${hiredPct}%` }" />
            </div>
          </div>
        </div>
      </section>

      <AppTabs v-model="tab" :tabs="tabs">
        <!-- Pipeline -->
        <div v-if="tab === 'pipeline'" class="space-y-4">
          <AppErrorState v-if="apps.error.value" class="card" :error="apps.error.value" @retry="apps.run" />
          <AppSkeleton v-else-if="apps.loading.value && !apps.data.value" :lines="6" />
          <div v-else-if="apps.data.value && !items.length" class="card">
            <AppEmptyState :icon="Users" title="No candidates yet" :description="job.data.value.status === 'OPEN' ? 'Add candidates you have sourced, or share the careers page so people can apply.' : 'Open the job to start adding candidates.'">
              <div class="flex flex-wrap justify-center gap-2">
                <AppButton v-if="canManage && job.data.value.status === 'OPEN'" :icon="UserPlus" @click="addOpen = true">Add candidate</AppButton>
                <AppButton v-if="publicUrl" variant="secondary" :icon="ExternalLink" :to="publicUrl">View public posting</AppButton>
              </div>
            </AppEmptyState>
          </div>
          <template v-else>
            <AppStatStrip :items="strip" selectable :selected="focus" label="Pipeline summary" @select="(k) => (focus = k as Focus | null)" />

            <div class="flex flex-wrap items-center gap-3">
              <AppSearchInput v-model="search" class="min-w-56 flex-1 sm:max-w-sm" placeholder="Find a candidate in this job" aria-label="Find a candidate in this job" />
              <AppSwitch v-model="showClosed" :label="`Show hired, rejected and withdrawn (${closedCount})`" />
              <AppSegmented v-model="layout" class="ms-auto w-44" size="sm" :options="layoutOptions" label="Pipeline layout" />
            </div>

            <div v-if="narrowed && !visible.length" class="card">
              <AppEmptyState compact :icon="SearchX" title="No candidates match" description="Try another name, or pick a different figure above.">
                <AppButton size="sm" variant="secondary" @click="clearNarrowing">Show everyone</AppButton>
              </AppEmptyState>
            </div>

            <!-- Board -->
            <div v-else-if="layout === 'board'" class="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2" role="list" aria-label="Pipeline stages">
              <section
                v-for="s in columnsShown"
                :key="s"
                role="listitem"
                :aria-label="`${STAGE_LABELS[s]}, ${byStage.get(s)?.length ?? 0} candidates`"
                :class="['flex min-h-[55vh] min-w-64 flex-1 basis-0 flex-col rounded-xl border border-line p-2.5', CLOSED.includes(s) ? 'bg-surface-muted/25' : 'bg-surface-muted/50']"
              >
                <header class="mb-2.5 flex items-center gap-2 px-1">
                  <span :class="['flex h-6 w-6 items-center justify-center rounded-md', stageSoft[s]]" aria-hidden="true"><component :is="STAGE_ICON[s]" :size="13" /></span>
                  <h2 class="text-sm font-semibold text-fg">{{ STAGE_LABELS[s] }}</h2>
                  <span class="rounded-full bg-surface px-1.5 text-2xs leading-4 font-semibold text-fg-muted tabular-nums ring-1 ring-line">{{ byStage.get(s)?.length ?? 0 }}</span>
                  <span v-if="(byStage.get(s) ?? []).some(stalled)" class="ms-auto text-2xs font-medium text-warning-fg">{{ (byStage.get(s) ?? []).filter(stalled).length }} waiting</span>
                </header>
                <div class="mb-2 h-0.5 rounded-full" :class="stageAccent[s]" aria-hidden="true" />
                <ul class="space-y-2">
                  <li v-for="a in byStage.get(s) ?? []" :key="a.id"><PipelineCard :app="a" @open="open(a)" /></li>
                </ul>
                <p v-if="!(byStage.get(s) ?? []).length" class="mt-2 rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-fg-subtle">No one here{{ narrowed ? ' that matches' : ' yet' }}</p>
              </section>
            </div>

            <!-- List -->
            <section v-else class="card overflow-hidden">
              <AppDataTable :columns="listColumns" :rows="listRows" :grid="false" clickable caption="Candidates in this job" empty-title="No candidates" @row-click="open">
                <template #cell-candidate="{ row }">
                  <div class="flex items-center gap-3">
                    <AppAvatar :name="row.candidate.name" size="sm" />
                    <div class="min-w-0">
                      <p class="truncate font-medium text-fg">{{ row.candidate.name }}</p>
                      <p class="truncate text-xs text-fg-muted">{{ [row.candidate.currentTitle, row.candidate.currentCompany].filter(Boolean).join(' at ') || row.candidate.email }}</p>
                    </div>
                  </div>
                </template>
                <template #cell-stage="{ row }"><AppBadge :tone="stageTone[row.stage]" dot>{{ STAGE_LABELS[row.stage] }}</AppBadge></template>
                <template #cell-source="{ row }">
                  <span class="inline-flex items-center gap-1.5 text-fg-muted"><component :is="SOURCE_ICON[row.source]" :size="13" aria-hidden="true" />{{ SOURCE_LABELS[row.source] }}</span>
                </template>
                <template #cell-experience="{ row }"><span class="text-fg-muted tabular-nums">{{ row.candidate.experienceYears !== null ? `${row.candidate.experienceYears} yrs` : '—' }}</span></template>
                <template #cell-rating="{ row }">
                  <span v-if="row.averageRating !== null" class="inline-flex items-center gap-1 text-sm font-medium text-fg tabular-nums">
                    <Star :size="13" class="fill-warning text-warning" aria-hidden="true" />{{ row.averageRating }}
                    <span class="text-xs font-normal text-fg-subtle">({{ row.feedbackCount }})</span>
                  </span>
                  <span v-else class="text-xs text-fg-subtle">No scorecards</span>
                </template>
                <template #cell-next="{ row }">
                  <template v-if="row.nextInterviewAt">
                    <p class="text-sm text-fg">{{ shortDay(row.nextInterviewAt) }}, {{ timeOfDay(row.nextInterviewAt) }}</p>
                    <p v-if="heldNotClosed(row)" :class="['text-2xs font-medium', feedbackLate(row) ? 'text-danger-fg' : 'text-warning-fg']">Held · awaiting feedback</p>
                  </template>
                  <span v-else class="text-xs text-fg-subtle">—</span>
                </template>
                <template #cell-age="{ row }">
                  <span :class="['rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', isActive(row) ? ageClass[stageAge(row.stageChangedAt).tone] : 'bg-surface-muted text-fg-muted']">
                    {{ stageAge(row.stageChangedAt).days }}d
                  </span>
                </template>
              </AppDataTable>
            </section>
          </template>
        </div>

        <!-- Posting -->
        <JobPostingPanel v-else :job="job.data.value" :applications="items" :public-url="publicUrl" :can-manage="canManage" @edit="editOpen = true" />
      </AppTabs>

      <JobFormModal :open="editOpen" :job="job.data.value" @close="editOpen = false" @saved="onEdited" />
      <CandidateFormModal :open="addOpen" :candidate="null" :job-id="job.data.value.id" @close="addOpen = false" @saved="onCandidateAdded" @existing="addExisting" />
    </template>
  </div>
</template>
