<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowDownToLine, CircleCheck, Pencil, UserPlus, Wrench } from '@lucide/vue';
import { ASSET_CATEGORY_LABELS, ASSET_CONDITIONS, type AssetCondition, type AssetStatus } from '@contracts';
import { employeesApi } from '@/modules/people/api/people.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import type { Colleague } from '@/modules/performance/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { assetsApi } from '@/modules/services/api/services.api';
import AssetFormModal from '@/modules/services/components/AssetFormModal.vue';
import type { AssetDetail } from '@/modules/services/types';
import { ASSET_CONDITION_LABELS, ASSET_ICONS, ASSET_STATUS_LABELS, assetStatusTone } from '@/modules/services/utils/services-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppFacts, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea, type Fact } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One asset: its details, who holds it, handing it over and taking it back, and every past assignment. */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const asset = useAsync(() => assetsApi.get(id.value));
const a = computed(() => asset.data.value);
const manage = computed(() => !!a.value?.permissions.manage);

const facts = computed<Fact[]>(() => {
  const x = a.value;
  if (!x) return [];
  return [
    { label: 'Category', value: ASSET_CATEGORY_LABELS[x.category] },
    { label: 'Serial number', value: x.serialNumber ?? '—' },
    { label: 'Make & model', value: x.model ?? '—' },
    { label: 'Condition', value: ASSET_CONDITION_LABELS[x.condition] },
    { label: 'Location', value: x.location?.name ?? '—' },
    { label: 'Purchased', value: x.purchaseDate ? `${formatDate(x.purchaseDate)}${x.purchaseCost != null ? ` · ${rupees(x.purchaseCost)}` : ''}` : x.purchaseCost != null ? rupees(x.purchaseCost) : '—' },
    { label: 'Warranty until', value: x.warrantyUntil ? formatDate(x.warrantyUntil) : '—' },
  ];
});

const editing = ref(false);
function onSaved(updated: AssetDetail) {
  editing.value = false;
  asset.data.value = updated;
  feedback.success('Saved');
}

type Action = 'assign' | 'return' | 'status';
const action = ref<Action | null>(null);
const form = reactive({ employeeId: null as string | null, condition: 'GOOD' as AssetCondition, status: 'IN_REPAIR' as Exclude<AssetStatus, 'ASSIGNED'>, note: '', error: '' });
const conditionOptions = ASSET_CONDITIONS.map((c) => ({ value: c, label: ASSET_CONDITION_LABELS[c] }));
const statusOptions = computed(() =>
  (['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'LOST'] as const).filter((s) => s !== a.value?.status && (a.value?.status !== 'ASSIGNED' || s === 'LOST')).map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
);
const search = async (q: string): Promise<Colleague[]> =>
  (await employeesApi.list({ page: 1, pageSize: 20, search: q || undefined, status: 'ACTIVE' })).items.map((e) => ({ id: e.id, name: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
function open(kind: Action) {
  Object.assign(form, { employeeId: null, condition: a.value?.condition ?? 'GOOD', status: statusOptions.value[0]?.value ?? 'IN_REPAIR', note: '', error: '' });
  action.value = kind;
}
const TITLES: Record<Action, string> = { assign: 'Hand over', return: 'Take back', status: 'Change status' };
const saving = ref(false);
async function submit() {
  saving.value = true;
  form.error = '';
  try {
    const note = form.note || null;
    asset.data.value =
      action.value === 'assign'
        ? await assetsApi.assign(id.value, { employeeId: form.employeeId!, condition: form.condition, note })
        : action.value === 'return'
          ? await assetsApi.returnAsset(id.value, { condition: form.condition, note })
          : await assetsApi.setStatus(id.value, { status: form.status, note });
    feedback.success(action.value === 'assign' ? 'Handed over' : action.value === 'return' ? 'Taken back' : 'Status changed');
    action.value = null;
  } catch (e) {
    form.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppSkeleton v-if="asset.loading.value && !a" :lines="6" />
    <AppErrorState v-else-if="asset.error.value" :error="asset.error.value" @retry="asset.run" />
    <template v-else-if="a">
      <AppPageHeader :title="a.name" :description="`${a.tag} · ${ASSET_CATEGORY_LABELS[a.category]}`" back="/hr/assets" back-label="Assets">
        <template v-if="manage" #actions>
          <AppButton variant="secondary" :icon="Pencil" @click="editing = true">Edit</AppButton>
          <AppButton v-if="a.status !== 'RETIRED' && statusOptions.length" variant="secondary" :icon="Wrench" @click="open('status')">Change status</AppButton>
          <AppButton v-if="a.status === 'ASSIGNED'" :icon="ArrowDownToLine" @click="open('return')">Take back</AppButton>
          <AppButton v-else-if="a.status === 'IN_STOCK'" :icon="UserPlus" @click="open('assign')">Hand over</AppButton>
        </template>
      </AppPageHeader>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div class="min-w-0 space-y-4">
          <section class="card overflow-hidden">
            <div class="flex flex-wrap items-center gap-4 hero-soft px-5 py-5">
              <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface text-accent-fg shadow-xs ring-1 ring-line" aria-hidden="true"><component :is="ASSET_ICONS[a.category]" :size="26" /></span>
              <div class="min-w-0 flex-1">
                <p class="font-mono text-xs text-fg-muted">{{ a.tag }}</p>
                <p class="truncate text-xl font-semibold text-fg">{{ a.name }}</p>
              </div>
              <AppBadge :tone="assetStatusTone[a.status]" dot>{{ ASSET_STATUS_LABELS[a.status] }}</AppBadge>
            </div>
            <div class="p-5"><AppFacts :items="facts" /></div>
            <p v-if="a.notes" class="border-t border-line/70 px-5 py-3 text-sm whitespace-pre-line text-fg-muted">{{ a.notes }}</p>
          </section>

          <AppCard title="History" :padded="false" description="Every hand-over and return, newest first.">
            <ol v-if="a.history.length" class="divide-y divide-line/70">
              <li v-for="h in a.history" :key="h.id" class="flex flex-wrap items-start gap-3 px-4 py-3">
                <AppAvatar :name="h.employee?.name ?? '?'" size="sm" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg">{{ h.employee?.name }} <span class="font-normal text-fg-muted">· {{ h.employee?.employeeCode }}</span></p>
                  <p class="text-xs text-fg-muted">
                    Handed over {{ formatDate(h.assignedAt) }}{{ h.assignedBy ? ` by ${h.assignedBy}` : '' }} · {{ ASSET_CONDITION_LABELS[h.conditionOut].toLowerCase() }}
                  </p>
                  <p v-if="h.returnedAt" class="text-xs text-fg-muted">
                    Returned {{ formatDate(h.returnedAt) }}{{ h.returnedBy ? ` to ${h.returnedBy}` : '' }}{{ h.conditionIn ? ` · ${ASSET_CONDITION_LABELS[h.conditionIn].toLowerCase()}` : '' }}
                  </p>
                  <p v-if="h.note" class="mt-0.5 text-xs text-fg-subtle">“{{ h.note }}”</p>
                </div>
                <AppBadge v-if="!h.returnedAt" tone="brand" size="sm">Current</AppBadge>
              </li>
            </ol>
            <p v-else class="px-4 py-6 text-center text-sm text-fg-muted">This asset hasn't been handed to anyone yet.</p>
          </AppCard>
        </div>

        <aside class="space-y-4">
          <AppCard title="Held by">
            <div v-if="a.assignedTo" class="space-y-3">
              <div class="flex items-center gap-3">
                <AppAvatar :name="a.assignedTo.name" />
                <div class="min-w-0">
                  <RouterLink :to="`/hr/employees/${a.assignedTo.id}`" class="block truncate font-medium text-fg hover:underline">{{ a.assignedTo.name }}</RouterLink>
                  <p class="truncate text-xs text-fg-muted">{{ a.assignedTo.employeeCode }}{{ a.assignedTo.department ? ` · ${a.assignedTo.department}` : '' }}</p>
                </div>
              </div>
              <p class="text-xs text-fg-muted">Since {{ formatDate(a.assignedAt) }}</p>
              <p v-if="a.history[0] && !a.history[0].returnedAt" :class="['flex items-center gap-1.5 text-xs', a.history[0].acknowledgedAt ? 'text-success-fg' : 'text-warning-fg']">
                <CircleCheck :size="14" aria-hidden="true" />{{ a.history[0].acknowledgedAt ? `Receipt confirmed ${formatDate(a.history[0].acknowledgedAt)}` : 'Receipt not confirmed yet' }}
              </p>
            </div>
            <p v-else class="text-sm text-fg-muted">{{ a.status === 'IN_STOCK' ? 'In stock, ready to hand out.' : `Not with anyone (${ASSET_STATUS_LABELS[a.status].toLowerCase()}).` }}</p>
          </AppCard>
        </aside>
      </div>

      <AssetFormModal :open="editing" :asset="a" @close="editing = false" @saved="onSaved" />
      <AppModal :open="!!action" dialog :title="action ? TITLES[action] : ''" :description="`${a.tag} · ${a.name}`" @close="action = null">
        <form id="asset-action" class="space-y-4" novalidate @submit.prevent="submit">
          <AppAlert v-if="form.error">{{ form.error }}</AppAlert>
          <ColleaguePicker v-if="action === 'assign'" v-model:value="form.employeeId" label="Employee" required :source="search" />
          <AppSelect v-if="action !== 'status'" v-model="form.condition" :label="action === 'return' ? 'Condition on return' : 'Condition'" :options="conditionOptions" :clearable="false" />
          <AppSelect v-else v-model="form.status" label="New status" :options="statusOptions" :clearable="false" />
          <AppAlert v-if="action === 'status' && form.status === 'LOST' && a.assignedTo" tone="warning">The assignment to {{ a.assignedTo.name }} is closed and the asset is recorded as lost.</AppAlert>
          <AppTextarea v-model="form.note" label="Note" :rows="2" :maxlength="500" />
        </form>
        <template #footer>
          <AppButton variant="secondary" @click="action = null">Cancel</AppButton>
          <AppButton type="submit" form="asset-action" :loading="saving" :disabled="action === 'assign' && !form.employeeId">{{ action ? TITLES[action] : '' }}</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
