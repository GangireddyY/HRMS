<script setup lang="ts">
import { computed, reactive, ref, type Component } from 'vue';
import { Check, ClipboardCheck, Clock, IdCard, Laptop, Minus, Pencil, Plus, UserRound, Users, Wallet } from '@lucide/vue';
import { CLEARANCE_DEPARTMENTS, CLEARANCE_STATUSES, type ClearanceDepartment, type ClearanceStatus } from '@contracts';
import { exitApi } from '@/modules/exit/api/exit.api';
import type { ClearanceItem, ExitDetail } from '@/modules/exit/types';
import { CLEARANCE_LABELS, DEPARTMENT_LABELS, clearanceTone, inr } from '@/modules/exit/utils/exit-format';
import { AppBadge, AppButton, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Clearance steps of an exit. Who can update a step: HR / clearance, or the manager for the handover. */
const props = defineProps<{ exit: ExitDetail }>();
const emit = defineEmits<{ updated: [e: ExitDetail] }>();

const feedback = useFeedbackStore();
const canEdit = (i: ClearanceItem) => props.exit.permissions.clear || (props.exit.permissions.clearManager && i.department === 'MANAGER');
const editing = ref<ClearanceItem | null>(null);
const form = reactive({ status: 'CLEARED' as ClearanceStatus, recoveryAmount: 0 as string | number, note: '' });
function open(i: ClearanceItem) {
  editing.value = i;
  Object.assign(form, { status: i.status === 'PENDING' ? 'CLEARED' : i.status, recoveryAmount: i.recoveryAmount || '', note: i.note ?? '' });
}
const busy = ref(false);
async function save() {
  if (!editing.value) return;
  busy.value = true;
  try {
    emit('updated', await exitApi.updateClearance(props.exit.id, editing.value.id, { status: form.status, recoveryAmount: Number(form.recoveryAmount) || 0, note: form.note || null }));
    feedback.success('Clearance updated');
    editing.value = null;
  } catch (e) {
    feedback.error('Could not update the clearance step', e);
  } finally {
    busy.value = false;
  }
}
const adding = ref(false);
const newItem = reactive({ department: 'ADMIN' as ClearanceDepartment, title: '' });
async function add() {
  busy.value = true;
  try {
    emit('updated', await exitApi.addClearance(props.exit.id, { department: newItem.department, title: newItem.title }));
    feedback.success('Step added');
    adding.value = false;
    newItem.title = '';
  } catch (e) {
    feedback.error('Could not add the step', e);
  } finally {
    busy.value = false;
  }
}
const statusOptions = CLEARANCE_STATUSES.map((s) => ({ value: s, label: CLEARANCE_LABELS[s] }));
const departmentOptions = CLEARANCE_DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }));
const recoveries = computed(() => props.exit.clearanceItems.reduce((s, i) => s + i.recoveryAmount, 0));

const DEPARTMENT_ICONS: Record<ClearanceDepartment, Component> = { MANAGER: Users, IT: Laptop, ADMIN: IdCard, FINANCE: Wallet, HR: UserRound };
const pending = computed(() => props.exit.clearanceItems.filter((i) => i.status === 'PENDING').length);
const pct = computed(() => (props.exit.clearance.total ? Math.round((props.exit.clearance.done / props.exit.clearance.total) * 100) : 0));
/** Sign-off progress per team, so it's clear who is holding things up. */
const teams = computed(() =>
  CLEARANCE_DEPARTMENTS.map((d) => {
    const items = props.exit.clearanceItems.filter((i) => i.department === d);
    return { key: d, total: items.length, open: items.filter((i) => i.status === 'PENDING').length };
  }).filter((t) => t.total),
);
</script>

<template>
  <section class="card overflow-hidden" aria-labelledby="hr-clearance-title">
    <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
      <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ClipboardCheck :size="16" /></span>
      <div class="min-w-0 flex-1">
        <h2 id="hr-clearance-title" class="text-sm font-semibold text-fg">Clearance</h2>
        <p class="text-xs text-fg-muted">
          {{ exit.clearance.done }} of {{ exit.clearance.total }} done<template v-if="recoveries"> · <span class="font-medium text-danger-fg">{{ inr(recoveries) }} to recover</span></template>
        </p>
      </div>
      <div v-if="exit.clearance.total" class="w-full sm:w-44">
        <p class="mb-1 flex justify-between text-2xs text-fg-muted">
          <span>{{ pending ? `${pending} pending` : 'All signed off' }}</span>
          <span class="font-medium text-fg tabular-nums">{{ pct }}%</span>
        </p>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" aria-label="Clearance progress">
          <div :class="['h-full rounded-full transition-[width] duration-700', pending ? 'bg-brand-500' : 'bg-success']" :style="{ width: `${pct}%` }" />
        </div>
      </div>
      <AppButton v-if="exit.permissions.clear" size="sm" variant="secondary" :icon="Plus" @click="adding = true">Add step</AppButton>
    </header>
    <ul v-if="teams.length > 1" class="flex flex-wrap gap-2 border-b border-line/70 bg-surface-muted/40 px-4 py-2.5" aria-label="Sign-off by team">
      <li
        v-for="t in teams"
        :key="t.key"
        :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset', t.open ? 'bg-surface text-fg ring-line' : 'bg-success-soft text-success-fg ring-success/20']"
      >
        <component :is="DEPARTMENT_ICONS[t.key]" :size="12" aria-hidden="true" />
        <span class="font-medium">{{ DEPARTMENT_LABELS[t.key] }}</span>
        <span class="tabular-nums" :class="t.open ? 'text-fg-muted' : ''">{{ t.open ? `${t.open} open` : 'done' }}</span>
      </li>
    </ul>
    <div v-if="exit.assetsHeld?.length" class="flex flex-wrap items-center gap-2 border-b border-line/70 bg-warning-soft/40 px-4 py-2.5 text-xs">
      <Laptop :size="14" class="text-warning-fg" aria-hidden="true" />
      <span class="font-medium text-warning-fg">Still with the employee:</span>
      <RouterLink v-for="a in exit.assetsHeld" :key="a.id" :to="`/hr/assets/${a.id}`" class="rounded-full bg-surface px-2 py-0.5 text-fg ring-1 ring-line ring-inset hover:underline">
        <span class="font-mono">{{ a.tag }}</span> · {{ a.name }}
      </RouterLink>
    </div>
    <p v-if="!exit.clearanceItems.length" class="px-4 py-4 text-sm text-fg-muted">Clearance starts when the exit is confirmed.</p>
    <ul v-else class="divide-y divide-line/70">
      <li v-for="i in exit.clearanceItems" :key="i.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span
          :class="[
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            i.status === 'CLEARED' ? 'bg-success text-white' : i.status === 'PENDING' ? 'bg-warning-soft text-warning-fg ring-1 ring-warning/30 ring-inset' : 'bg-surface-muted text-fg-subtle',
          ]"
          aria-hidden="true"
        >
          <Check v-if="i.status === 'CLEARED'" :size="14" :stroke-width="3" />
          <Clock v-else-if="i.status === 'PENDING'" :size="14" />
          <Minus v-else :size="14" />
        </span>
        <div class="min-w-0 flex-1 basis-56">
          <p :class="['text-sm', i.status === 'NOT_APPLICABLE' ? 'text-fg-muted' : 'font-medium text-fg']">{{ i.title }}</p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
            <span class="inline-flex items-center gap-1"><component :is="DEPARTMENT_ICONS[i.department]" :size="12" aria-hidden="true" />{{ DEPARTMENT_LABELS[i.department] }}</span>
            <template v-if="i.clearedBy && i.clearedAt"><span aria-hidden="true">·</span><span>{{ i.clearedBy }}, {{ formatDate(i.clearedAt) }}</span></template>
            <template v-if="i.note"><span aria-hidden="true">·</span><span class="italic">“{{ i.note }}”</span></template>
          </p>
          <p v-if="i.recoveryAmount" class="mt-1 text-xs font-medium text-danger-fg tabular-nums">Recover {{ inr(i.recoveryAmount) }}</p>
        </div>
        <AppBadge :tone="clearanceTone[i.status]" size="sm" dot>{{ CLEARANCE_LABELS[i.status] }}</AppBadge>
        <AppButton v-if="canEdit(i) && exit.status === 'APPROVED'" size="sm" :variant="i.status === 'PENDING' ? 'secondary' : 'ghost'" :icon="i.status === 'PENDING' ? Check : Pencil" :aria-label="`${i.status === 'PENDING' ? 'Sign off' : 'Update'}: ${i.title}`" @click="open(i)">
          {{ i.status === 'PENDING' ? 'Sign off' : 'Update' }}
        </AppButton>
      </li>
    </ul>
    <AppModal :open="!!editing" :title="editing?.title ?? ''" :description="editing ? DEPARTMENT_LABELS[editing.department] : undefined" size="sm" @close="editing = null">
      <div class="space-y-4">
        <AppSelect v-model="form.status" label="Status" :options="statusOptions" :clearable="false" />
        <AppInput v-if="exit.permissions.clear" v-model="form.recoveryAmount" label="Amount to recover (₹)" type="number" :min="0" help="Deducted in the full & final settlement." />
        <AppTextarea v-model="form.note" label="Note" :rows="2" :maxlength="1000" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton :loading="busy" @click="save">Save</AppButton>
      </template>
    </AppModal>
    <AppModal :open="adding" title="Add a clearance step" size="sm" @close="adding = false">
      <div class="space-y-4">
        <AppSelect v-model="newItem.department" label="Department" :options="departmentOptions" :clearable="false" />
        <AppInput v-model="newItem.title" label="Step" :maxlength="200" placeholder="e.g. Company car returned" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="adding = false">Cancel</AppButton>
        <AppButton :loading="busy" :disabled="newItem.title.trim().length < 3" @click="add">Add</AppButton>
      </template>
    </AppModal>
  </section>
</template>
