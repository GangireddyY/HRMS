<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Loader2, Maximize2, Minus, Network, Plus, ScanSearch, Users } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import OrgChartTree from '@/modules/people/components/OrgChartTree.vue';
import { useDevice } from '@/shared/composables/use-device';
import type { OrgChartNode } from '@/modules/people/types';
import { EMPLOYEE_STATUS_LABELS } from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSelect, AppSkeleton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();

/** Children per manager id ('' = top of the visible hierarchy), loaded one level at a time. */
const children = reactive(new Map<string, OrgChartNode[]>());
const expanded = reactive(new Set<string>());
const loadingIds = reactive(new Set<string>());
const rootError = ref<unknown>(null);
const focused = ref<string | null>(null);

async function load(managerId: string) {
  if (children.has(managerId)) return;
  loadingIds.add(managerId);
  try {
    children.set(managerId, await employeesApi.orgChart(managerId || undefined));
  } finally {
    loadingIds.delete(managerId);
  }
}

async function loadRoots() {
  rootError.value = null;
  children.delete('');
  try {
    await load('');
  } catch (e) {
    rootError.value = e;
  }
}

async function toggle(node: OrgChartNode) {
  if (!node.reportCount) return;
  if (expanded.has(node.id)) {
    expanded.delete(node.id);
    return;
  }
  try {
    await load(node.id);
    expanded.add(node.id);
  } catch (e) {
    feedback.error('Could not load the team', e);
  }
}

interface Row {
  node: OrgChartNode;
  depth: number;
  last: boolean[];
}
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const walk = (nodes: OrgChartNode[], depth: number, last: boolean[]) =>
    nodes.forEach((node, i) => {
      const trail = [...last, i === nodes.length - 1];
      out.push({ node, depth, last: trail });
      if (expanded.has(node.id)) walk(children.get(node.id) ?? [], depth + 1, trail);
    });
  walk(children.get('') ?? [], 0, []);
  return out;
});
const topReports = computed(() => (children.get('') ?? []).reduce((n, r) => n + r.reportCount, 0));

/** Opens the hierarchy down to an employee and highlights them. */
async function focus(id: string) {
  try {
    const chain = await employeesApi.reportingChain(id);
    await load('');
    for (const manager of [...chain].reverse()) {
      await load(manager.id);
      expanded.add(manager.id);
    }
    focused.value = id;
    await nextTick();
    if (view.value === 'chart') centreOn(id);
    else document.getElementById(`org-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (e) {
    feedback.error('Could not find this employee in the org chart', e);
  }
}

const search = ref<string | null>(null);
const searchOptions = ref<{ value: string; label: string; description?: string }[]>([]);
async function onSearch(q: string) {
  if (q.trim().length < 2) return;
  try {
    const res = await employeesApi.list({ search: q, status: 'ACTIVE', pageSize: 20 });
    searchOptions.value = res.items.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})`, description: e.designation?.name }));
  } catch {
    searchOptions.value = [];
  }
}
watch(search, (id) => {
  if (id) void router.replace({ query: { focus: id } });
});
watch(
  () => route.query.focus,
  (id) => {
    if (typeof id === 'string') void focus(id);
  },
);

function collapseAll() {
  expanded.clear();
  focused.value = null;
  void nextTick(() => reset());
}

/** Opens one more level under every open branch's leaves (at most 30 teams at a time). */
async function expandLevel() {
  const leaves: OrgChartNode[] = [];
  const walk = (nodes: OrgChartNode[]) =>
    nodes.forEach((n) => {
      if (expanded.has(n.id)) walk(children.get(n.id) ?? []);
      else if (n.reportCount) leaves.push(n);
    });
  walk(children.get('') ?? []);
  try {
    await Promise.all(leaves.slice(0, 30).map((n) => load(n.id)));
    for (const n of leaves.slice(0, 30)) expanded.add(n.id);
    await nextTick();
    fit();
  } catch (e) {
    feedback.error('Could not load the teams', e);
  }
}

// ---- Chart view: drag to move, Ctrl / ⌘ + wheel or the buttons to zoom --------------------------
const { isDesktop } = useDevice();
const VIEW_KEY = 'hrms.org-chart.view';
const view = ref<'chart' | 'list'>((localStorage.getItem(VIEW_KEY) as 'chart' | 'list' | null) ?? (isDesktop.value ? 'chart' : 'list'));
watch(view, (v) => {
  localStorage.setItem(VIEW_KEY, v);
  if (v === 'chart') void nextTick(() => reset());
});
const viewOptions = [
  { value: 'chart' as const, label: 'Chart' },
  { value: 'list' as const, label: 'List' },
];
const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const zoom = ref(1);
const pan = reactive({ x: 0, y: 0 });
const dragging = ref(false);
let drag: { x: number; y: number; px: number; py: number } | null = null;
const clampZoom = (z: number) => Math.min(1.6, Math.max(0.3, Math.round(z * 100) / 100));

function zoomAt(next: number, cx?: number, cy?: number) {
  const vp = viewport.value;
  if (!vp) return;
  const z = clampZoom(next);
  const x = cx ?? vp.clientWidth / 2;
  const y = cy ?? vp.clientHeight / 2;
  pan.x = x - ((x - pan.x) * z) / zoom.value;
  pan.y = y - ((y - pan.y) * z) / zoom.value;
  zoom.value = z;
}
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    const r = viewport.value!.getBoundingClientRect();
    zoomAt(zoom.value * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  } else {
    pan.x -= e.deltaX;
    pan.y -= e.deltaY;
  }
}
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!drag) return;
  pan.x = drag.px + e.clientX - drag.x;
  pan.y = drag.py + e.clientY - drag.y;
}
function onPointerUp() {
  drag = null;
  dragging.value = false;
}
/** Top of the chart centred, at 100 %. */
function reset() {
  const vp = viewport.value;
  const c = content.value;
  if (!vp || !c) return;
  zoom.value = 1;
  pan.x = (vp.clientWidth - c.offsetWidth) / 2;
  pan.y = 64;
}
/** The whole open chart in view. */
function fit() {
  const vp = viewport.value;
  const c = content.value;
  if (!vp || !c) return;
  const z = clampZoom(Math.min(1, (vp.clientWidth - 48) / c.offsetWidth, (vp.clientHeight - 96) / c.offsetHeight));
  zoom.value = z;
  pan.x = (vp.clientWidth - c.offsetWidth * z) / 2;
  pan.y = 64;
}
/** Moves the chart so a person's card is in the middle. */
function centreOn(id: string) {
  const vp = viewport.value;
  const el = document.getElementById(`org-card-${id}`);
  if (!vp || !el) return;
  const v = vp.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  pan.x += v.left + v.width / 2 - (r.left + r.width / 2);
  pan.y += v.top + v.height / 3 - (r.top + r.height / 2);
}
/** Opening or closing a team re-centres the rows; keep the card that was clicked where it was. */
async function toggleInChart(node: OrgChartNode) {
  const before = document.getElementById(`org-card-${node.id}`)?.getBoundingClientRect();
  await toggle(node);
  await nextTick();
  const after = document.getElementById(`org-card-${node.id}`)?.getBoundingClientRect();
  if (before && after) {
    pan.x -= after.left - before.left;
    pan.y -= after.top - before.top;
  }
}
function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest('input, textarea, [role="combobox"]')) return;
  if (e.key === '+' || e.key === '=') zoomAt(zoom.value * 1.15);
  else if (e.key === '-') zoomAt(zoom.value / 1.15);
  else if (e.key === '0') reset();
}

onMounted(async () => {
  await loadRoots();
  await nextTick();
  reset();
  if (typeof route.query.focus === 'string') await focus(route.query.focus);
});
</script>

<template>
  <div class="flex flex-col lg:h-full">
    <AppPageHeader title="Org chart" description="Reporting lines across the organization, within what you can see.">
      <template #actions>
        <AppSelect
          v-model="search"
          class="w-72 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
          :options="searchOptions"
          placeholder="Find an employee…"
          searchable
          remote
          :clearable="false"
          aria-label="Find an employee in the org chart"
          @search="onSearch"
        />
        <AppSegmented v-model="view" class="w-32 shrink-0 max-sm:w-28!" :options="viewOptions" label="View" />
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="loadingIds.has('') && !children.has('')" class="card p-4" :lines="6" />
    <AppCard v-else-if="rootError"><AppErrorState :error="rootError" title="Could not load the org chart" @retry="loadRoots" /></AppCard>
    <AppCard v-else-if="!rows.length"><AppEmptyState :icon="Network" title="No reporting lines yet" description="Add employees and set who they report to." /></AppCard>

    <!-- Chart -->
    <section v-else-if="view === 'chart'" class="card relative overflow-hidden lg:min-h-0 lg:flex-1" aria-label="Org chart canvas">
      <div
        ref="viewport"
        tabindex="0"
        :class="['bg-dots relative h-[70vh] touch-none overflow-hidden select-none focus-visible:outline-none lg:h-full', dragging ? 'cursor-grabbing' : 'cursor-grab']"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @keydown="onKey"
      >
        <div ref="content" class="absolute top-0 left-0 w-max origin-top-left pb-16" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
          <OrgChartTree root :nodes="children.get('') ?? []" :children-of="children" :expanded="expanded" :loading="loadingIds" :focused="focused" @toggle="toggleInChart" />
        </div>
      </div>

      <div class="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 max-md:justify-end">
        <p class="pointer-events-auto inline-flex items-center gap-2 rounded-md border border-line bg-surface/90 px-2.5 py-1.5 text-xs text-fg-muted shadow-xs backdrop-blur max-md:hidden">
          <Users class="h-3.5 w-3.5" aria-hidden="true" />
          {{ (children.get('') ?? []).length }} at the top · {{ topReports }} direct report{{ topReports === 1 ? '' : 's' }}
        </p>
        <div class="pointer-events-auto flex items-center gap-1 rounded-md border border-line bg-surface/90 p-1 shadow-xs backdrop-blur" role="toolbar" aria-label="Chart controls">
          <AppButton size="xs" variant="ghost" :icon="ChevronsUpDown" aria-label="Expand a level" @click="expandLevel"><span class="max-sm:hidden">Expand a level</span></AppButton>
          <AppButton size="xs" variant="ghost" :icon="ChevronsDownUp" aria-label="Collapse" :disabled="!expanded.size" @click="collapseAll"><span class="max-sm:hidden">Collapse</span></AppButton>
          <span class="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
          <AppButton size="xs" variant="ghost" :icon="Minus" aria-label="Zoom out" @click="zoomAt(zoom / 1.2)" />
          <button type="button" class="min-w-12 rounded px-1 text-xs font-medium text-fg-muted tabular-nums hover:bg-surface-muted hover:text-fg" title="Reset to 100 %" @click="reset">{{ Math.round(zoom * 100) }}%</button>
          <AppButton size="xs" variant="ghost" :icon="Plus" aria-label="Zoom in" @click="zoomAt(zoom * 1.2)" />
          <AppButton size="xs" variant="ghost" :icon="Maximize2" aria-label="Fit to screen" @click="fit" />
        </div>
      </div>
      <p class="pointer-events-none absolute start-3 bottom-3 inline-flex items-center gap-1.5 rounded-md bg-surface/80 px-2 py-1 text-2xs text-fg-subtle backdrop-blur max-sm:hidden">
        <ScanSearch class="h-3.5 w-3.5" aria-hidden="true" />Drag to move · Ctrl + scroll to zoom · open a team with its "reports" button
      </p>
    </section>

    <!-- List -->
    <AppCard v-else :padded="false">
      <template v-if="rows.length">
        <div class="flex items-center gap-2 border-b border-line px-4 py-3 text-xs text-fg-muted">
          <AppButton class="ms-auto" size="xs" variant="ghost" :icon="ChevronsDownUp" :disabled="!expanded.size" @click="collapseAll">Collapse all</AppButton>
          <Users class="order-first h-3.5 w-3.5" aria-hidden="true" />
          {{ (children.get('') ?? []).length.toLocaleString() }} {{ (children.get('') ?? []).length === 1 ? 'person' : 'people' }} at the top · {{ topReports.toLocaleString() }} direct report{{ topReports === 1 ? '' : 's' }} below them
        </div>
        <ul class="py-2" role="tree" aria-label="Org chart">
          <li
            v-for="r in rows"
            :id="`org-${r.node.id}`"
            :key="r.node.id"
            role="treeitem"
            :aria-expanded="r.node.reportCount ? expanded.has(r.node.id) : undefined"
            :aria-level="r.depth + 1"
            class="relative"
          >
            <div class="flex items-stretch" :style="{ paddingLeft: `${12 + r.depth * 28}px` }">
              <!-- Connector lines for each ancestor level. -->
              <span
                v-for="d in r.depth"
                :key="d"
                class="pointer-events-none absolute top-0 bottom-0 border-l border-line"
                :class="d === r.depth && r.last[d] ? 'h-1/2' : ''"
                :style="{ left: `${12 + (d - 1) * 28 + 13}px`, ...(d < r.depth && r.last[d] ? { display: 'none' } : {}) }"
                aria-hidden="true"
              />
              <span v-if="r.depth" class="pointer-events-none absolute top-1/2 w-3.5 border-t border-line" :style="{ left: `${12 + (r.depth - 1) * 28 + 13}px` }" aria-hidden="true" />
              <div
                class="my-1 me-3 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors"
                :class="focused === r.node.id ? 'bg-brand-500/10 ring-1 ring-brand-500/40' : 'hover:bg-surface-muted/70'"
              >
                <button
                  type="button"
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg disabled:invisible"
                  :disabled="!r.node.reportCount"
                  :aria-label="expanded.has(r.node.id) ? `Collapse ${r.node.name}'s team` : `Expand ${r.node.name}'s team`"
                  @click="toggle(r.node)"
                >
                  <Loader2 v-if="loadingIds.has(r.node.id)" class="h-4 w-4 animate-spin" aria-hidden="true" />
                  <ChevronRight v-else class="h-4 w-4 transition-transform" :class="expanded.has(r.node.id) ? 'rotate-90' : ''" aria-hidden="true" />
                </button>
                <AppAvatar :name="r.node.name" size="sm" />
                <RouterLink :to="`/hr/employees/${r.node.id}`" class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-fg hover:underline">{{ r.node.name }}</span>
                  <span class="block truncate text-xs text-fg-muted">{{ [r.node.designation?.name, r.node.department?.name].filter(Boolean).join(' · ') || r.node.employeeCode }}</span>
                </RouterLink>
                <AppBadge v-if="r.node.status !== 'ACTIVE'" tone="warning" size="sm">{{ EMPLOYEE_STATUS_LABELS[r.node.status] }}</AppBadge>
                <button
                  v-if="r.node.reportCount"
                  type="button"
                  class="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted tabular-nums hover:text-fg"
                  @click="toggle(r.node)"
                >
                  {{ r.node.reportCount }} report{{ r.node.reportCount === 1 ? '' : 's' }}
                </button>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </AppCard>
  </div>
</template>
