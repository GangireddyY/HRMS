<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AlertTriangle, CheckCircle2, ClipboardList, FileBarChart, PenLine, Printer, Scale, ShieldCheck } from '@lucide/vue';
import { GRIEVANCE_OUTCOMES, POSH_INQUIRY_DAYS, type GrievanceOutcome } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import { OUTCOME_HELP, OUTCOME_LABELS } from '@/modules/grievance/utils/grievance-format';
import { AppAlert, AppButton, AppCard, AppErrorState, AppPageHeader, AppSelect, AppSkeleton, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** Figures for the Internal Committee's annual report (section 21 and rule 14 of the POSH Act), laid out to print. */
const auth = useAuthStore();
const thisYear = new Date().getFullYear();
const year = ref(thisYear);
const yearOptions = Array.from({ length: 6 }, (_, i) => ({ value: thisYear - i, label: String(thisYear - i) }));
const report = useAsync(() => grievanceApi.poshReport(year.value));
watch(year, () => void report.run());
const r = computed(() => report.data.value);
const print = () => window.print();

const strip = computed<StripItem[]>(() => {
  const x = r.value;
  if (!x) return [];
  return [
    { key: 'received', label: 'Complaints received', value: x.received, hint: `During ${x.year}`, tone: 'brand' },
    { key: 'disposed', label: 'Disposed of', value: x.disposed, hint: 'Inquiry or conciliation complete', tone: 'success' },
    { key: 'withdrawn', label: 'Withdrawn', value: x.withdrawn, hint: 'By the complainant', tone: 'neutral' },
    { key: 'pending', label: 'Pending', value: x.pending, hint: 'Still with the committee', tone: 'info' },
    { key: 'over90', label: `Pending over ${POSH_INQUIRY_DAYS} days`, value: x.pendingOver90Days, hint: x.pendingOver90Days ? 'Past the inquiry time limit' : 'None past the time limit', tone: 'danger' },
  ];
});
/** Share of the year's complaints that are finished (disposed of or withdrawn). */
const closedPct = computed(() => (r.value?.received ? Math.round(((r.value.disposed + r.value.withdrawn) / r.value.received) * 100) : 0));
const share = (n: number) => (r.value?.received ? `${(n / r.value.received) * 100}%` : '0%');
const outcomeTotal = computed(() => GRIEVANCE_OUTCOMES.reduce((s, o) => s + (r.value?.outcomes[o] ?? 0), 0));
const OUTCOME_BAR: Record<GrievanceOutcome, string> = { UPHELD: 'bg-danger', PARTIALLY_UPHELD: 'bg-warning', NOT_UPHELD: 'bg-info', SETTLED: 'bg-success' };
const CIRC = 2 * Math.PI * 42;

/** The contents rule 14 asks for: (a)–(c) come from the case records, (d) and (e) are added by the committee. */
const rule14 = computed(() => {
  const x = r.value;
  if (!x) return [];
  return [
    { item: '(a)', label: 'Number of complaints of sexual harassment received in the year', value: String(x.received) },
    { item: '(b)', label: 'Number of complaints disposed of during the year', value: String(x.disposed) },
    { item: '(c)', label: `Number of cases pending for more than ${POSH_INQUIRY_DAYS} days`, value: String(x.pendingOver90Days) },
    { item: '(d)', label: 'Number of workshops or awareness programmes against sexual harassment carried out', value: null },
    { item: '(e)', label: 'Nature of action taken by the employer or District Officer', value: null },
  ];
});
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="POSH annual report" description="Figures for the Internal Committee's annual report to the employer and the District Officer (section 21)." back="/hr/grievances" back-label="Grievances" class="print:mb-2 print:[&>a]:hidden">
      <template #actions>
        <div class="flex items-center gap-2 print:hidden">
          <AppSelect v-model="year" :options="yearOptions" :clearable="false" aria-label="Calendar year" class="w-32" />
          <AppButton variant="secondary" :icon="Printer" @click="print">Print</AppButton>
        </div>
      </template>
    </AppPageHeader>
    <AppSkeleton v-if="report.loading.value && !r" :lines="6" />
    <AppErrorState v-else-if="report.error.value" :error="report.error.value" @retry="report.run" />
    <template v-else-if="r">
      <!-- Report heading -->
      <section class="card overflow-hidden print:shadow-none" aria-labelledby="report-title">
        <div class="flex flex-wrap items-center gap-5 bg-gradient-to-br from-violet-500/10 via-surface to-brand-500/10 px-6 py-5 dark:from-violet-500/20 dark:to-brand-500/15 print:bg-none">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm print:hidden" aria-hidden="true"><Scale :size="22" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-2xs font-semibold tracking-wide text-special-fg uppercase">Internal Committee · Annual report</p>
            <h2 id="report-title" class="mt-0.5 text-xl font-semibold tracking-tight text-fg">Calendar year {{ r.year }}<template v-if="auth.organization"> · {{ auth.organization.name }}</template></h2>
            <p class="mt-0.5 text-sm text-fg-muted">Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 — figures as of {{ formatDate(r.asOf) }}.</p>
          </div>
          <div v-if="r.received" class="flex items-center gap-3">
            <div class="relative h-20 w-20">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" class="stroke-surface-muted" />
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" stroke-linecap="round" class="stroke-success" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - closedPct / 100)" />
              </svg>
              <span class="absolute inset-0 flex items-center justify-center text-lg font-semibold text-fg tabular-nums">{{ closedPct }}%</span>
            </div>
            <p class="text-xs text-fg-muted">of the year's<br />complaints<br />concluded</p>
          </div>
        </div>
      </section>

      <AppStatStrip :items="strip" label="Report figures" />

      <AppAlert v-if="r.pendingOver90Days" tone="warning" :title="`${r.pendingOver90Days} ${r.pendingOver90Days === 1 ? 'inquiry has' : 'inquiries have'} been pending for more than ${POSH_INQUIRY_DAYS} days`">
        The Act asks the committee to complete an inquiry within {{ POSH_INQUIRY_DAYS }} days (section 11(4)). The report must state these cases.
      </AppAlert>

      <div class="grid items-stretch gap-4 lg:grid-cols-2 print:grid-cols-2">
        <AppCard title="Where the year's complaints stand" :icon="FileBarChart" description="Received, split by what happened to them" class="print:shadow-none" fill>
          <template v-if="r.received">
            <div class="flex h-3 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${r.disposed} disposed of, ${r.withdrawn} withdrawn, ${r.pending} pending`">
              <span class="h-full bg-success" :style="{ width: share(r.disposed) }" />
              <span class="h-full bg-fg-subtle/60" :style="{ width: share(r.withdrawn) }" />
              <span class="h-full bg-info" :style="{ width: share(r.pending) }" />
            </div>
            <ul class="mt-4 space-y-2.5 text-sm">
              <li class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-success" aria-hidden="true" /><span class="flex-1 text-fg-muted">Disposed of</span><span class="font-medium text-fg tabular-nums">{{ r.disposed }}</span></li>
              <li class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-fg-subtle/60" aria-hidden="true" /><span class="flex-1 text-fg-muted">Withdrawn</span><span class="font-medium text-fg tabular-nums">{{ r.withdrawn }}</span></li>
              <li class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-info" aria-hidden="true" /><span class="flex-1 text-fg-muted">Pending</span><span class="font-medium text-fg tabular-nums">{{ r.pending }}</span></li>
              <li class="flex items-center gap-2 border-t border-line/70 pt-2.5"><span class="flex-1 font-medium text-fg">Received</span><span class="font-semibold text-fg tabular-nums">{{ r.received }}</span></li>
            </ul>
          </template>
          <p v-else class="flex items-center gap-2 text-sm text-fg-muted"><ShieldCheck :size="16" class="text-success-fg" aria-hidden="true" />No complaints of sexual harassment were received in {{ r.year }}.</p>
        </AppCard>

        <AppCard title="Outcomes of complaints disposed of" :icon="CheckCircle2" :description="r.withdrawn ? `${r.withdrawn} complaint${r.withdrawn === 1 ? ' was' : 's were'} withdrawn.` : 'Findings recorded by the committee'" class="print:shadow-none" fill>
          <dl class="space-y-3 text-sm">
            <div v-for="o in GRIEVANCE_OUTCOMES" :key="o">
              <div class="flex items-baseline justify-between gap-4">
                <dt class="min-w-0">
                  <span class="text-fg">{{ OUTCOME_LABELS[o] }}</span>
                  <span class="block truncate text-xs text-fg-subtle">{{ OUTCOME_HELP[o] }}</span>
                </dt>
                <dd class="font-semibold text-fg tabular-nums">{{ r.outcomes[o] ?? 0 }}</dd>
              </div>
              <span class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <span :class="['block h-full rounded-full', OUTCOME_BAR[o]]" :style="{ width: outcomeTotal ? `${((r.outcomes[o] ?? 0) / outcomeTotal) * 100}%` : '0%' }" />
              </span>
            </div>
          </dl>
        </AppCard>
      </div>

      <section class="card overflow-hidden print:break-inside-avoid print:shadow-none" aria-labelledby="rule14-title">
        <header class="flex min-h-12 items-center gap-3 border-b border-line/70 px-4 py-2">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs print:hidden" aria-hidden="true"><ClipboardList :size="16" /></span>
          <div class="min-w-0 flex-1">
            <h2 id="rule14-title" class="text-sm font-semibold text-fg">Contents of the annual report (rule 14)</h2>
            <p class="text-xs text-fg-muted">Items (a) to (c) come from the case records; add (d) and (e) when filing.</p>
          </div>
        </header>
        <table class="w-full text-sm">
          <caption class="sr-only">Contents of the annual report</caption>
          <thead class="border-b border-line bg-surface-muted/70 text-xs text-fg-muted">
            <tr>
              <th scope="col" class="w-14 px-4 py-2 text-start font-semibold">Item</th>
              <th scope="col" class="px-4 py-2 text-start font-semibold">Particulars</th>
              <th scope="col" class="w-40 px-4 py-2 text-end font-semibold">Figure</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line/70">
            <tr v-for="row in rule14" :key="row.item">
              <td class="px-4 py-2.5 font-mono text-xs text-fg-muted">{{ row.item }}</td>
              <td class="px-4 py-2.5 text-fg">{{ row.label }}</td>
              <td class="px-4 py-2.5 text-end">
                <span v-if="row.value !== null" class="text-base font-semibold text-fg tabular-nums">{{ row.value }}</span>
                <span v-else class="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-fg print:bg-transparent print:px-0">
                  <PenLine :size="11" aria-hidden="true" class="print:hidden" />Add when filing
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="flex items-start gap-2 border-t border-line/70 bg-surface-muted/50 px-4 py-2.5 text-xs text-fg-muted">
          <AlertTriangle :size="13" class="mt-0.5 shrink-0" aria-hidden="true" />The report contains figures only — no names or case details. Submit it to the employer and the District Officer, and include the figures in the employer's annual report (section 22).
        </p>
      </section>
    </template>
  </div>
</template>
