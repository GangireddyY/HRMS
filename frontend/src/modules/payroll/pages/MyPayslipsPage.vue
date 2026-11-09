<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, ChevronRight, Clock, FileText, Info, LineChart, ReceiptText, Sparkles, Wallet } from '@lucide/vue';
import { financialYearLabel, financialYearOf } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { useAssistantStore } from '@/modules/assistant/assistant.store';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import PaySplitBar, { type PaySegment } from '@/modules/payroll/components/PaySplitBar.vue';
import type { MyPayslip } from '@/modules/payroll/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSkeleton, AppSparkline, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Own payslips: the latest one with where the money went, year-to-date totals, the net pay trend and every payslip by financial year. */
const assistant = useAssistantStore();
const list = useAsync(() => payrollApi.myPayslips());
const rows = computed(() => list.data.value ?? []);
const latest = computed(() => rows.value[0] ?? null);
const previous = computed(() => rows.value[1] ?? null);
/** The latest payslip's lines, for the breakdown; the page works without them. */
const detail = useAsync(() => payrollApi.payslip(latest.value!.id), { immediate: false });
watch(
  () => latest.value?.id,
  (id) => {
    if (id) void detail.run();
  },
  { immediate: true },
);
const lines = computed(() => (detail.data.value && detail.data.value.id === latest.value?.id ? detail.data.value : null));

/** Totals for the financial year of the latest payslip. */
const year = computed(() => {
  if (!rows.value.length) return null;
  const fy = financialYearOf(rows.value[0]!.year, rows.value[0]!.month);
  const inYear = rows.value.filter((p) => financialYearOf(p.year, p.month) === fy);
  const net = inYear.reduce((n, p) => n + p.netPay, 0);
  return { label: financialYearLabel(fy), count: inYear.length, gross: inYear.reduce((n, p) => n + p.gross, 0), net, deductions: inYear.reduce((n, p) => n + p.totalDeductions, 0), average: Math.round(net / inYear.length) };
});
const strip = computed<StripItem[]>(() => {
  const y = year.value;
  if (!y) return [];
  return [
    { key: 'gross', label: `Gross pay · ${y.label}`, value: rupees(y.gross), tone: 'brand', hint: 'Earnings before deductions' },
    { key: 'deductions', label: `Deductions · ${y.label}`, value: rupees(y.deductions), tone: 'warning', hint: y.gross ? `${pct(y.deductions, y.gross)} of gross pay` : undefined },
    { key: 'net', label: `Net pay · ${y.label}`, value: rupees(y.net), tone: 'success', hint: `Average ${rupees(y.average)} a month` },
    { key: 'count', label: 'Payslips this year', value: y.count, tone: 'info', hint: `${y.count} of 12 months` },
  ];
});
const pct = (part: number, whole: number) => {
  const v = whole ? (part / whole) * 100 : 0;
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
};

// ---- Latest payslip --------------------------------------------------------------------------------------------
const change = computed(() => {
  if (!latest.value || !previous.value) return null;
  const diff = latest.value.netPay - previous.value.netPay;
  return { diff, pct: previous.value.netPay ? Math.abs(Math.round((diff / previous.value.netPay) * 1000) / 10) : 0, period: previous.value.period };
});
const DEDUCTION_COLORS = ['bg-amber-400 dark:bg-amber-500', 'bg-orange-400 dark:bg-orange-500', 'bg-rose-400 dark:bg-rose-500', 'bg-yellow-400 dark:bg-yellow-500', 'bg-red-400 dark:bg-red-500'];
const split = computed<PaySegment[]>(() => {
  const l = latest.value;
  if (!l) return [];
  const deductions = lines.value?.deductions.length
    ? lines.value.deductions.map((d, i) => ({ key: `d-${d.code}-${i}`, label: d.name, amount: d.amount, color: DEDUCTION_COLORS[i % DEDUCTION_COLORS.length]! }))
    : [{ key: 'deductions', label: 'Deductions', amount: l.totalDeductions, color: DEDUCTION_COLORS[0]! }];
  return [{ key: 'net', label: 'Net pay', amount: l.netPay, color: 'bg-brand-500' }, ...deductions];
});
const employerTotal = computed(() => lines.value?.employerContributions.reduce((n, c) => n + c.amount, 0) ?? 0);

// ---- All payslips ----------------------------------------------------------------------------------------------
const fyOf = (p: MyPayslip) => financialYearOf(p.year, p.month);
const years = computed(() => [...new Set(rows.value.map(fyOf))]);
const fyFilter = ref<string>('all');
const fyOptions = computed(() => [{ value: 'all', label: 'All years' }, ...years.value.slice(0, 4).map((fy) => ({ value: String(fy), label: financialYearLabel(fy) }))]);
const groups = computed(() =>
  years.value
    .filter((fy) => fyFilter.value === 'all' || String(fy) === fyFilter.value)
    .map((fy) => {
      const items = rows.value.filter((p) => fyOf(p) === fy);
      return { fy, label: financialYearLabel(fy), items, net: items.reduce((n, p) => n + p.netPay, 0) };
    }),
);
const tile = (p: MyPayslip) => ({ month: new Date(p.year, p.month - 1, 1).toLocaleDateString(appLocale(), { month: 'short' }), year: p.year });
const statusText = (p: MyPayslip) => (p.status === 'PAID' ? (p.paidAt ? `Paid ${formatDate(p.paidAt)}` : 'Paid') : 'Approved · payment on its way');

// ---- Trend -----------------------------------------------------------------------------------------------------
const trend = computed(() => rows.value.slice(0, 12).reverse());
const trendStats = computed(() => {
  const v = trend.value.map((p) => p.netPay);
  if (v.length < 2) return null;
  return { high: Math.max(...v), low: Math.min(...v), average: Math.round(v.reduce((n, x) => n + x, 0) / v.length), from: trend.value[0]!.period, to: trend.value.at(-1)!.period };
});
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Payslips" description="Your monthly payslips once payroll is approved. Open one to print or save it as a PDF.">
      <template #actions><AppButton variant="secondary" :icon="Wallet" to="/me/salary">Salary & tax</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="list.loading.value && !list.data.value" :lines="5" />
    <AppErrorState v-else-if="list.error.value" :error="list.error.value" @retry="list.run" />
    <section v-else-if="!latest" class="card">
      <AppEmptyState :icon="FileText" title="No payslips yet" description="Your payslip appears here as soon as the month's payroll is approved. You'll be able to view, print and save it as a PDF.">
        <AppButton variant="secondary" :icon="Wallet" to="/me/salary">See your salary structure</AppButton>
      </AppEmptyState>
    </section>
    <template v-else>
      <!-- Latest payslip -->
      <section class="card grid grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" aria-labelledby="latest-title">
        <div class="relative flex flex-col hero-banner p-6 text-white">
          <div class="relative flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur"><ReceiptText :size="13" aria-hidden="true" />Latest payslip</span>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
              <span :class="['h-1.5 w-1.5 rounded-full', latest.status === 'PAID' ? 'bg-emerald-500' : 'bg-sky-500']" aria-hidden="true" />{{ latest.status === 'PAID' ? 'Paid' : 'Approved' }}
            </span>
          </div>
          <h2 id="latest-title" class="relative mt-4 text-lg font-medium text-white/90">{{ latest.period }}</h2>
          <p class="relative text-xs tracking-wide text-white/70 uppercase">Net pay</p>
          <p class="relative mt-0.5 text-4xl font-semibold tracking-tight tabular-nums">{{ rupees(latest.netPay) }}</p>
          <div class="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/85">
            <span v-if="latest.status === 'PAID'" class="inline-flex items-center gap-1.5"><CalendarCheck :size="13" aria-hidden="true" />{{ latest.paidAt ? `Paid ${formatDate(latest.paidAt)} · ${timeAgo(latest.paidAt)}` : 'Paid' }}</span>
            <span v-else class="inline-flex items-center gap-1.5"><Clock :size="13" aria-hidden="true" />Approved · payment on its way</span>
            <span v-if="change" class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 font-medium">
              <component :is="change.diff >= 0 ? ArrowUpRight : ArrowDownRight" :size="13" aria-hidden="true" />
              {{ change.diff === 0 ? 'Same as' : `${change.diff > 0 ? '+' : ''}${rupees(change.diff)} (${change.pct}%) vs` }} {{ change.period }}
            </span>
          </div>
          <div class="relative mt-auto flex flex-wrap gap-2 pt-6">
            <RouterLink
              :to="`/me/payslips/${latest.id}`"
              class="inline-flex h-9 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-white/90 focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none"
            >
              <FileText :size="15" aria-hidden="true" />View & download
            </RouterLink>
            <button
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-md bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/30 backdrop-blur transition ring-inset hover:bg-white/25 focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none"
              @click="assistant.ask('my latest payslip')"
            >
              <Sparkles :size="15" aria-hidden="true" />Ask AI about my pay
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-5 p-6">
          <div>
            <div class="mb-2 flex items-baseline justify-between gap-3">
              <h3 class="text-sm font-semibold text-fg">Where your pay went</h3>
              <span class="text-xs text-fg-muted">Gross <span class="font-semibold text-fg tabular-nums">{{ rupees(latest.gross) }}</span></span>
            </div>
            <PaySplitBar :segments="split" :label="`${latest.period} gross pay`" size="lg" />
            <dl class="mt-4 grid grid-cols-3 gap-3">
              <div class="rounded-lg bg-surface-muted/60 px-3 py-2.5">
                <dt class="flex items-center gap-1.5 text-2xs font-medium text-fg-muted"><span class="h-2 w-2 rounded-sm bg-line-strong" aria-hidden="true" />Gross earnings</dt>
                <dd class="mt-0.5 text-base font-semibold text-fg tabular-nums">{{ rupees(latest.gross) }}</dd>
              </div>
              <div class="rounded-lg bg-surface-muted/60 px-3 py-2.5">
                <dt class="flex items-center gap-1.5 text-2xs font-medium text-fg-muted"><span class="h-2 w-2 rounded-sm bg-amber-400 dark:bg-amber-500" aria-hidden="true" />Deductions</dt>
                <dd class="mt-0.5 text-base font-semibold text-fg tabular-nums">− {{ rupees(latest.totalDeductions) }}</dd>
                <dd class="text-2xs text-fg-subtle">{{ pct(latest.totalDeductions, latest.gross) }} of gross</dd>
              </div>
              <div class="rounded-lg bg-accent-soft/60 px-3 py-2.5 ring-1 ring-brand-500/15 ring-inset">
                <dt class="flex items-center gap-1.5 text-2xs font-medium text-accent-fg"><span class="h-2 w-2 rounded-sm bg-brand-500" aria-hidden="true" />Net pay</dt>
                <dd class="mt-0.5 text-base font-semibold text-fg tabular-nums">{{ rupees(latest.netPay) }}</dd>
                <dd class="text-2xs text-fg-subtle">{{ pct(latest.netPay, latest.gross) }} take-home</dd>
              </div>
            </dl>
          </div>

          <AppSkeleton v-if="detail.loading.value && !lines" :lines="3" />
          <div v-else-if="lines" class="grid gap-5 sm:grid-cols-2">
            <div>
              <h4 class="mb-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Earnings</h4>
              <ul class="divide-y divide-line/60 text-sm">
                <li v-for="(e, i) in lines.earnings" :key="`${e.code}-${i}`" class="flex items-center justify-between gap-3 py-1.5">
                  <span class="truncate text-fg">{{ e.name }}</span><span class="text-fg tabular-nums">{{ rupees(e.amount) }}</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 class="mb-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Deductions</h4>
              <ul v-if="lines.deductions.length" class="divide-y divide-line/60 text-sm">
                <li v-for="(d, i) in lines.deductions" :key="`${d.code}-${i}`" class="flex items-center gap-2 py-1.5">
                  <span :class="['h-2 w-2 shrink-0 rounded-sm', DEDUCTION_COLORS[i % DEDUCTION_COLORS.length]]" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate text-fg">{{ d.name }}</span><span class="text-fg tabular-nums">− {{ rupees(d.amount) }}</span>
                </li>
              </ul>
              <p v-else class="py-1.5 text-sm text-fg-muted">No deductions this month.</p>
            </div>
          </div>
          <p v-if="lines" class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 pt-3 text-xs text-fg-muted">
            <span class="tabular-nums">Paid days <span class="font-medium text-fg">{{ lines.payableDays }} of {{ lines.daysInMonth }}</span></span>
            <span v-if="lines.lopOverride ?? lines.lopDays" class="text-warning-fg tabular-nums">Loss of pay {{ lines.lopOverride ?? lines.lopDays }} day{{ (lines.lopOverride ?? lines.lopDays) === 1 ? '' : 's' }}</span>
            <span v-if="employerTotal" class="tabular-nums">Employer contributions {{ rupees(employerTotal) }} <span class="text-fg-subtle">(part of CTC, not deducted)</span></span>
          </p>
        </div>
      </section>

      <AppStatStrip :items="strip" :label="`Totals for ${year?.label}`" />

      <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <!-- All payslips -->
        <section class="card" aria-labelledby="all-title">
          <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ReceiptText :size="16" /></span>
              <div>
                <h2 id="all-title" class="text-sm font-semibold text-fg">All payslips <span class="font-normal text-fg-muted tabular-nums">· {{ rows.length }}</span></h2>
                <p class="text-xs text-fg-muted">Open one to see every line, print it or save it as a PDF.</p>
              </div>
            </div>
            <AppSegmented v-if="years.length > 1" v-model="fyFilter" class="w-full sm:w-auto" size="sm" :options="fyOptions" label="Financial year" />
          </header>
          <div v-for="g in groups" :key="g.fy">
            <h3 class="flex items-center justify-between gap-3 border-b border-line/60 bg-surface-muted/50 px-4 py-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
              <span>{{ g.label }} <span class="font-normal normal-case tabular-nums">· {{ g.items.length }} payslip{{ g.items.length === 1 ? '' : 's' }}</span></span>
              <span class="normal-case tabular-nums">Net {{ rupees(g.net) }}</span>
            </h3>
            <ul class="divide-y divide-line/70">
              <li v-for="p in g.items" :key="p.id">
                <RouterLink :to="`/me/payslips/${p.id}`" class="group flex items-center gap-3 px-4 py-3.5 sm:gap-4 transition-colors hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 focus-visible:outline-none">
                  <div class="flex w-14 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1.5 ring-1 ring-line/60 ring-inset">
                    <span class="text-2xs font-semibold text-accent-fg uppercase">{{ tile(p).month }}</span>
                    <span class="text-sm leading-5 font-semibold text-fg tabular-nums">{{ tile(p).year }}</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="flex items-center gap-2 text-sm font-semibold text-fg">
                      {{ p.period }}<AppBadge v-if="p.id === latest.id" size="sm" tone="brand">Latest</AppBadge>
                    </p>
                    <p class="truncate text-xs text-fg-muted">{{ statusText(p) }}</p>
                  </div>
                  <dl class="hidden gap-6 text-end md:flex">
                    <div class="w-24"><dt class="text-2xs text-fg-subtle">Gross</dt><dd class="text-sm text-fg-muted tabular-nums">{{ rupees(p.gross) }}</dd></div>
                    <div class="w-24"><dt class="text-2xs text-fg-subtle">Deductions</dt><dd class="text-sm text-fg-muted tabular-nums">− {{ rupees(p.totalDeductions) }}</dd></div>
                  </dl>
                  <div class="w-28 text-end">
                    <p class="text-2xs text-fg-subtle">Net pay</p>
                    <p class="text-base font-semibold text-fg tabular-nums">{{ rupees(p.netPay) }}</p>
                  </div>
                  <span class="hidden sm:block"><AppBadge :tone="p.status === 'PAID' ? 'success' : 'info'" size="sm" dot>{{ p.status === 'PAID' ? 'Paid' : 'Approved' }}</AppBadge></span>
                  <ChevronRight :size="16" class="text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden="true" />
                </RouterLink>
              </li>
            </ul>
          </div>
        </section>

        <aside class="space-y-4">
          <AppCard title="Net pay trend" :icon="LineChart" :description="trendStats ? `${trendStats.from} – ${trendStats.to}` : 'Month by month'">
            <template v-if="trendStats">
              <AppSparkline :values="trend.map((p) => p.netPay)" tone="brand" :height="56" />
              <dl class="mt-3 grid grid-cols-3 gap-2 text-center">
                <div><dt class="text-2xs text-fg-muted">Highest</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(trendStats.high) }}</dd></div>
                <div><dt class="text-2xs text-fg-muted">Average</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(trendStats.average) }}</dd></div>
                <div><dt class="text-2xs text-fg-muted">Lowest</dt><dd class="text-sm font-semibold text-fg tabular-nums">{{ rupees(trendStats.low) }}</dd></div>
              </dl>
            </template>
            <div v-else class="flex items-center gap-3 rounded-lg bg-surface-muted/60 px-3 py-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-fg-subtle ring-1 ring-line ring-inset" aria-hidden="true"><LineChart :size="15" /></span>
              <p class="text-xs text-fg-muted">Your trend appears once you have payslips for two months.</p>
            </div>
          </AppCard>

          <AppCard title="Reading your payslip" :icon="Info">
            <dl class="space-y-3 text-sm">
              <div>
                <dt class="font-medium text-fg">Gross earnings</dt>
                <dd class="text-xs text-fg-muted">Basic, allowances and any extra pay for the month, before anything is taken off.</dd>
              </div>
              <div>
                <dt class="font-medium text-fg">Deductions</dt>
                <dd class="text-xs text-fg-muted">Your provident fund, professional tax, income tax (TDS) and any loan repayments.</dd>
              </div>
              <div>
                <dt class="font-medium text-fg">Net pay</dt>
                <dd class="text-xs text-fg-muted">What reaches your bank account: gross earnings minus deductions.</dd>
              </div>
            </dl>
            <div class="mt-4 space-y-2">
              <AppButton block variant="secondary" :icon="Sparkles" @click="assistant.ask('my latest payslip')">Ask AI about my pay</AppButton>
              <AppButton block variant="ghost" :icon-right="ArrowRight" to="/me/salary">Salary structure & tax declaration</AppButton>
            </div>
          </AppCard>
        </aside>
      </div>
    </template>
  </div>
</template>
