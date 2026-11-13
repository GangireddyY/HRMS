<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/vue';
import { APPROVAL_CHAIN_MAX_STEPS, APPROVAL_SUBJECT_LABELS, APPROVAL_SUBJECTS, PERMISSIONS, type ApprovalSubject, type ApproverKind } from '@contracts';
import { approvalChainsApi, type ApprovalChainInput, type ApprovalChainRow } from '@/modules/approval-chains/api/approval-chains.api';
import { usersApi } from '@/modules/users/api/users.api';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppSwitch } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Create or edit an approval chain: kind of request, when it applies, and its ordered steps. */
const props = defineProps<{ open: boolean; chain: ApprovalChainRow | null; defaultSubject: ApprovalSubject }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();

const APPROVER_LABELS: Record<ApproverKind, string> = { MANAGER: 'Their manager', SKIP_MANAGER: "Their manager's manager", PERMISSION: 'Holders of a permission', USER: 'A named person' };
const approverOptions = (Object.keys(APPROVER_LABELS) as ApproverKind[]).map((k) => ({ value: k, label: APPROVER_LABELS[k] }));
const permissionOptions = PERMISSIONS.filter((p) => /approve|finance|manage|process/.test(p.key)).map((p) => ({ value: p.key, label: `${p.description} (${p.key})` }));
const subjectOptions = APPROVAL_SUBJECTS.map((s) => ({ value: s, label: APPROVAL_SUBJECT_LABELS[s] }));

interface Step {
  label: string | number | null;
  approver: ApproverKind;
  permission?: string;
  membershipId?: string;
  slaHours: string | number | null;
}
const subject = ref<ApprovalSubject>('LEAVE');
const name = ref<string | number | null>('');
const priority = ref<string | number | null>(100);
const active = ref(true);
const minDays = ref<string | number | null>(null);
const minAmount = ref<string | number | null>(null);
const steps = ref<Step[]>([]);
const saving = ref(false);
const members = ref<{ value: string; label: string }[]>([]);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    reset();
    const c = props.chain;
    subject.value = c?.subject ?? props.defaultSubject;
    name.value = c?.name ?? '';
    priority.value = c?.priority ?? 100;
    active.value = c?.isActive ?? true;
    minDays.value = c?.conditions.minDays ?? null;
    minAmount.value = c?.conditions.minAmount ?? null;
    steps.value = c ? c.steps.map((s) => ({ ...s, slaHours: s.slaHours ?? null })) : [{ label: 'Manager', approver: 'MANAGER', slaHours: 48 }];
    if (!members.value.length) {
      const page = await usersApi.list({ page: 1, pageSize: 100, status: 'ACTIVE' }).catch(() => null);
      members.value = (page?.items ?? []).map((m) => ({ value: m.id, label: `${m.firstName} ${m.lastName} · ${m.email}` }));
    }
  },
  { immediate: true },
);

const amountBased = computed(() => subject.value === 'EXPENSE' || subject.value === 'TRAVEL' || subject.value === 'OFFER');
const n = (v: string | number | null) => (v === '' || v === null ? undefined : Number(v));
const valid = computed(() => String(name.value ?? '').trim().length >= 2 && steps.value.length > 0 && steps.value.every((s) => String(s.label ?? '').trim().length >= 2 && (s.approver !== 'PERMISSION' || !!s.permission) && (s.approver !== 'USER' || !!s.membershipId)));

function add() {
  steps.value.push({ label: 'HR', approver: 'PERMISSION', permission: subject.value === 'EXPENSE' ? 'payroll.reimbursement.finance' : 'leave.approve', slaHours: 48 });
}
function move(i: number, d: -1 | 1) {
  const s = steps.value;
  [s[i], s[i + d]] = [s[i + d]!, s[i]!];
}

async function save() {
  reset();
  saving.value = true;
  const body: ApprovalChainInput = {
    subject: subject.value,
    name: String(name.value).trim(),
    priority: n(priority.value) ?? 100,
    isActive: active.value,
    conditions: { ...(n(minDays.value) !== undefined && !amountBased.value ? { minDays: n(minDays.value) } : {}), ...(n(minAmount.value) !== undefined && amountBased.value ? { minAmount: n(minAmount.value) } : {}) },
    steps: steps.value.map((s) => ({
      label: String(s.label).trim(),
      approver: s.approver,
      ...(s.approver === 'PERMISSION' ? { permission: s.permission } : {}),
      ...(s.approver === 'USER' ? { membershipId: s.membershipId } : {}),
      slaHours: n(s.slaHours) ?? null,
    })),
  };
  try {
    if (props.chain) await approvalChainsApi.update(props.chain.id, body);
    else await approvalChainsApi.create(body);
    emit('saved');
  } catch (e) {
    handle(e, 'Could not save the approval chain');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="chain ? 'Edit approval chain' : 'New approval chain'" description="Steps run in order; anyone listed for the current step who also holds this kind of request's approve permission can decide (a step with nobody like that is skipped). Requests already in progress keep the chain they started with." size="lg" @close="emit('close')">
    <form id="chain-editor" class="space-y-6" @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="subject" label="Approves" :options="subjectOptions" :error="fieldErrors.subject" />
        <AppInput v-model="name" label="Name" placeholder="Long leave: manager then HR" :error="fieldErrors.name" />
        <AppInput v-model="priority" type="number" label="Priority" help="Lower is tried first" :min="1" :max="999" :error="fieldErrors.priority" />
        <AppInput v-if="amountBased" v-model="minAmount" type="number" label="Applies from amount" help="Empty = every amount" :min="0" :error="fieldErrors['conditions.minAmount']" />
        <AppInput v-else v-model="minDays" type="number" label="Applies from days" help="Empty = every request" :min="0" :step="0.5" :error="fieldErrors['conditions.minDays']" />
        <AppSwitch v-model="active" class="sm:col-span-2" label="Active" description="Inactive chains are skipped; the module's built-in approval applies when no chain matches." />
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-fg">Steps</p>
          <AppButton size="sm" variant="secondary" :icon="Plus" :disabled="steps.length >= APPROVAL_CHAIN_MAX_STEPS" @click="add">Add step</AppButton>
        </div>
        <ol class="space-y-2">
          <li v-for="(s, i) in steps" :key="i" class="rounded-xl bg-surface-muted/40 p-3 ring-1 ring-line ring-inset">
            <div class="mb-2 flex items-center gap-2">
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{{ i + 1 }}</span>
              <span class="flex-1 text-xs text-fg-muted">{{ i === 0 ? 'First' : `After step ${i}` }}</span>
              <AppButton size="xs" variant="ghost" :icon="ArrowUp" :disabled="i === 0" :aria-label="`Move step ${i + 1} up`" @click="move(i, -1)" />
              <AppButton size="xs" variant="ghost" :icon="ArrowDown" :disabled="i === steps.length - 1" :aria-label="`Move step ${i + 1} down`" @click="move(i, 1)" />
              <AppButton size="xs" variant="ghost" :icon="Trash2" :disabled="steps.length === 1" :aria-label="`Remove step ${i + 1}`" @click="steps.splice(i, 1)" />
            </div>
            <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_110px]">
              <AppInput v-model="s.label" label="Step name" :error="fieldErrors[`steps.${i}.label`]" />
              <AppSelect v-model="s.approver" label="Who decides" :options="approverOptions" />
              <AppInput v-model="s.slaHours" type="number" label="Deadline" suffix="h" :min="1" :max="720" help="Then escalate" />
              <AppSelect v-if="s.approver === 'PERMISSION'" v-model="s.permission" class="sm:col-span-3" label="Permission (department- or organization-wide holders)" :options="permissionOptions" searchable :error="fieldErrors[`steps.${i}.permission`]" />
              <AppSelect v-if="s.approver === 'USER'" v-model="s.membershipId" class="sm:col-span-3" label="Approver" :options="members" searchable :error="fieldErrors[`steps.${i}.membershipId`]" />
            </div>
          </li>
        </ol>
        <p class="mt-2 text-xs text-fg-muted">A step nobody can decide (for example, no manager on record) is skipped. People can't approve their own requests or two steps of the same request.</p>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="chain-editor" :loading="saving" :disabled="!valid">{{ chain ? 'Save chain' : 'Create chain' }}</AppButton>
    </template>
  </AppModal>
</template>
