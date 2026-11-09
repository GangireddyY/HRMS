<script setup lang="ts">
import { computed, type Component } from 'vue';
import { Bar, Line } from 'vue-chartjs';
import { BarElement, CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement, PointElement, Tooltip, type ChartOptions } from 'chart.js';
import { ArrowDownRight, ArrowUpRight, BarChart3 } from '@lucide/vue';
import { useThemePalette } from '@/core/theme/use-theme-palette';
import { formatValue, type ValueFormat } from '@/modules/reports/utils/report-definitions';
import { AppCard, AppEmptyState } from '@/shared/components';

ChartJS.register(BarElement, LineElement, PointElement, Filler, CategoryScale, LinearScale, Tooltip);

/**
 * Monthly series as bars (flows, e.g. cost) or a filled line (levels, e.g. headcount), with the latest value and its
 * change over the period in the header. A visually hidden table carries the same figures for screen readers.
 */
const props = withDefaults(
  defineProps<{ title: string; description?: string; icon?: Component; points: { label: string; value: number }[]; format: ValueFormat; kind?: 'bar' | 'line'; height?: string }>(),
  { icon: () => BarChart3, kind: 'bar', height: 'h-60' },
);
const palette = useThemePalette();
/** The palette gives `#rrggbb` or `rgb(r g b)`. */
const withAlpha = (color: string, alpha: number) =>
  /^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : color.replace(/^rgb\(([^/)]+)(?:\/[^)]*)?\)$/i, `rgb($1 / ${alpha})`);

const latest = computed(() => props.points.at(-1) ?? null);
const change = computed(() => {
  const first = props.points[0]?.value;
  const last = latest.value?.value;
  if (props.points.length < 2 || first === undefined || last === undefined || last === first) return null;
  const diff = last - first;
  return { diff, label: `${diff > 0 ? '+' : '−'}${formatValue(Math.abs(diff), props.format)}`, up: diff > 0 };
});

const data = computed(() => {
  const { brand } = palette.value;
  const labels = props.points.map((p) => p.label);
  const values = props.points.map((p) => p.value);
  if (props.kind === 'line') {
    return {
      labels,
      datasets: [{ data: values, borderColor: brand, backgroundColor: withAlpha(brand, 0.12), fill: true, tension: 0.35, cubicInterpolationMode: 'monotone' as const, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: brand }],
    };
  }
  // The latest month stands out; earlier months recede.
  return {
    labels,
    datasets: [{ data: values, backgroundColor: values.map((_, i) => (i === values.length - 1 ? brand : withAlpha(brand, 0.45))), hoverBackgroundColor: brand, borderRadius: 6, borderSkipped: false, maxBarThickness: 36 }],
  };
});

const options = computed<ChartOptions<'bar' | 'line'>>(() => {
  const { grid, text, surface, fg, border } = palette.value;
  const values = props.points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(1, Math.ceil((max - min) * 0.25));
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: surface,
        titleColor: fg,
        bodyColor: fg,
        borderColor: border,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 10,
        displayColors: false,
        titleFont: { weight: 600 },
        callbacks: { label: (c) => formatValue(Number(c.raw), props.format) },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: text, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } } },
      y: {
        beginAtZero: props.kind === 'bar',
        ...(props.kind === 'line' ? { suggestedMin: Math.max(0, min - pad), suggestedMax: max + pad } : {}),
        border: { display: false },
        grid: { color: grid, drawTicks: false },
        ticks: { color: text, padding: 8, maxTicksLimit: 5, precision: 0, font: { size: 11 }, callback: (v) => formatValue(Number(v), props.format === 'money' ? 'money' : 'number') },
      },
    },
  };
});
</script>

<template>
  <AppCard :title="title" :description="description" :icon="icon" fill>
    <template v-if="latest" #actions>
      <div class="text-end">
        <p class="text-sm font-semibold text-fg tabular-nums">{{ formatValue(latest.value, format) }}</p>
        <p class="flex items-center justify-end gap-1 text-2xs text-fg-muted">
          <span v-if="change" :class="['inline-flex items-center font-medium tabular-nums', change.up ? 'text-success-fg' : 'text-danger-fg']">
            <component :is="change.up ? ArrowUpRight : ArrowDownRight" :size="12" aria-hidden="true" />{{ change.label }}
          </span>
          <span>{{ change ? `over ${points.length - 1} month${points.length === 2 ? '' : 's'}` : latest.label }}</span>
        </p>
      </div>
    </template>
    <AppEmptyState v-if="!points.length" class="flex-1" compact :icon="BarChart3" title="No data in this period" description="Try a longer period or another department." />
    <template v-else>
      <div :class="['relative min-h-0 flex-1', height]">
        <Line v-if="kind === 'line'" :data="data as never" :options="options as never" :aria-label="title" role="img" />
        <Bar v-else :data="data as never" :options="options as never" :aria-label="title" role="img" />
      </div>
      <table class="sr-only">
        <caption>{{ title }}</caption>
        <tbody>
          <tr v-for="p in points" :key="p.label"><th scope="row">{{ p.label }}</th><td>{{ formatValue(p.value, format) }}</td></tr>
        </tbody>
      </table>
    </template>
  </AppCard>
</template>
