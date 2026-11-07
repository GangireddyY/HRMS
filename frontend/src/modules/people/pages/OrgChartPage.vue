<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronRight, ChevronsDownUp, Loader2, Network, Users } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import type { OrgChartNode } from '@/modules/people/types';
import { EMPLOYEE_STATUS_LABELS } from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSelect, AppSkeleton } from '@/shared/components';
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
    document.getElementById(`org-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
}

onMounted(async () => {
  await loadRoots();
  if (typeof route.query.focus === 'string') await focus(route.query.focus);
});
</script>

<template>
  <div>
    <AppPageHeader title="Org chart" description="Reporting lines across the organization (within what you can see). Expand a manager to see their team.">
      <template #actions>
        <AppSelect
          v-model="search"
          class="w-72 max-sm:w-full"
          :options="searchOptions"
          placeholder="Find an employee…"
          searchable
          remote
          :clearable="false"
          aria-label="Find an employee in the org chart"
          @search="onSearch"
        />
        <AppButton variant="secondary" :icon="ChevronsDownUp" :disabled="!expanded.size" @click="collapseAll">Collapse all</AppButton>
      </template>
    </AppPageHeader>

    <AppCard :padded="false">
      <AppSkeleton v-if="loadingIds.has('') && !children.has('')" class="p-4" :lines="6" />
      <AppErrorState v-else-if="rootError" :error="rootError" title="Could not load the org chart" @retry="loadRoots" />
      <AppEmptyState v-else-if="!rows.length" :icon="Network" title="No reporting lines yet" description="Add employees and set who they report to." />
      <template v-else>
        <div class="flex items-center gap-2 border-b border-line px-4 py-3 text-xs text-fg-muted">
          <Users class="h-3.5 w-3.5" aria-hidden="true" />
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
                class="my-1 mr-3 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors"
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
