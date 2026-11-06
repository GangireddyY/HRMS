<script setup lang="ts">
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip, type ChartOptions } from 'chart.js';
import type { DailyLoginStat } from '@/modules/audit/types';
import { useThemePalette } from '@/core/theme/use-theme-palette';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const props = defineProps<{ stats: DailyLoginStat[]; days?: number }>();
const palette = useThemePalette();

/** Fills every day in the window so gaps render as zero. */
const series = computed(() => {
  const days = props.days ?? 14;
  const labels: string[] = [];
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    keys.push(d.toISOString().slice(0, 10));
    labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  const pick = (outcomes: string[]) => keys.map((k) => props.stats.filter((s) => s.day === k && outcomes.includes(s.outcome)).reduce((a, s) => a + s.count, 0));
  return { labels, success: pick(['SUCCESS']), failure: pick(['FAILURE', 'LOCKED']) };
});

const data = computed(() => ({
  labels: series.value.labels,
  datasets: [
    {
      label: 'Successful',
      data: series.value.success,
      backgroundColor: palette.value.brand,
      hoverBackgroundColor: palette.value.brand,
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 16,
      categoryPercentage: 0.7,
    },
    {
      label: 'Failed',
      data: series.value.failure,
      backgroundColor: palette.value.danger,
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 16,
      categoryPercentage: 0.7,
    },
  ],
}));

const options = computed<ChartOptions<'bar'>>(() => {
  const { grid, text, surface, fg, border } = palette.value;
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: { color: text, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 12, family: 'Inter Variable, Inter, sans-serif' } },
      },
      tooltip: {
        backgroundColor: surface,
        titleColor: fg,
        bodyColor: fg,
        borderColor: border,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 10,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { weight: 600 },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: text, maxRotation: 0, autoSkipPadding: 14, font: { size: 11 } } },
      y: {
        stacked: true,
        beginAtZero: true,
        border: { display: false, dash: [4, 4] },
        grid: { color: grid, drawTicks: false },
        ticks: { color: text, precision: 0, padding: 8, font: { size: 11 }, maxTicksLimit: 5 },
      },
    },
  };
});
</script>

<template>
  <div class="h-64" role="img" :aria-label="`Sign-in activity for the last ${days ?? 14} days`">
    <Bar :data="data" :options="options" />
  </div>
</template>
