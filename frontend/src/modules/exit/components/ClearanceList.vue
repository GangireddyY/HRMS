<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Plus } from '@lucide/vue';
import { CLEARANCE_DEPARTMENTS, CLEARANCE_STATUSES, type ClearanceDepartment, type ClearanceStatus } from '@contracts';
import { exitApi } from '@/modules/exit/api/exit.api';
import type { ClearanceItem, ExitDetail } from '@/modules/exit/types';
import { CLEARANCE_LABELS, DEPARTMENT_LABELS, clearanceTone, inr } from '@/modules/exit/utils/exit-format';
import { AppBadge, AppButton, AppCard, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
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
</script>

<template>
  <AppCard title="Clearance" :description="`${exit.clearance.done} of ${exit.clearance.total} done${recoveries ? ` · ${inr(recoveries)} to recover` : ''}`" :padded="false">
    <template v-if="exit.permissions.clear" #actions>
      <AppButton size="sm" variant="secondary" :icon="Plus" @click="adding = true">Add step</AppButton>
    </template>
    <p v-if="!exit.clearanceItems.length" class="px-4 py-4 text-sm text-fg-muted">Clearance starts when the exit is confirmed.</p>
    <ul v-else class="divide-y divide-line">
      <li v-for="i in exit.clearanceItems" :key="i.id" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <span class="w-16 shrink-0 text-xs font-medium text-fg-muted">{{ DEPARTMENT_LABELS[i.department] }}</span>
        <div class="min-w-0 flex-1">
          <p class="text-fg">{{ i.title }}</p>
          <p v-if="i.note || i.clearedBy || i.recoveryAmount" class="text-xs text-fg-muted">
            {{ [i.recoveryAmount ? `recover ${inr(i.recoveryAmount)}` : null, i.note, i.clearedBy ? `${i.clearedBy}, ${formatDate(i.clearedAt!)}` : null].filter(Boolean).join(' · ') }}
          </p>
        </div>
        <AppBadge :tone="clearanceTone[i.status]" dot>{{ CLEARANCE_LABELS[i.status] }}</AppBadge>
        <AppButton v-if="canEdit(i) && exit.status === 'APPROVED'" size="sm" variant="ghost" :aria-label="`Update ${i.title}`" @click="open(i)">Update</AppButton>
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
  </AppCard>
</template>
