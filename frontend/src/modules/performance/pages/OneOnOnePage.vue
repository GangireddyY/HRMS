<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarClock, CalendarX2, CheckCircle2, History, ListTodo, Lock, MessagesSquare, NotebookPen, Plus, Trash2, UsersRound } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { performanceApi } from '@/modules/performance/api/performance.api';
import ScheduleOneOnOneModal from '@/modules/performance/components/ScheduleOneOnOneModal.vue';
import type { OneOnOneDetail, OneOnOneItem } from '@/modules/performance/types';
import { ONE_ON_ONE_STATUS_LABELS, oneOnOneTone } from '@/modules/performance/utils/performance-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { addDaysIso } from '@/shared/utils/dates';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** One 1:1: the shared agenda, actions and notes, plus the manager's private notes. */
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const meeting = useAsync(() => performanceApi.oneOnOne(id.value));
watch(id, () => void meeting.run());
const m = computed(() => meeting.data.value);
const other = computed(() => (m.value ? (m.value.viewer.isManager ? m.value.employee : m.value.manager) : null));
const fmt = new Intl.DateTimeFormat(appLocale(), { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

const notes = reactive({ shared: '', private: '' });
watch(
  m,
  (v) => {
    if (!v) return;
    notes.shared = v.sharedNotes ?? '';
    notes.private = v.managerNotes ?? '';
  },
  { immediate: true },
);
const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<OneOnOneDetail>, success?: string) {
  busy.value = key;
  try {
    meeting.data.value = await fn();
    if (success) feedback.success(success);
  } catch (e) {
    feedback.error('Could not save', e);
  } finally {
    busy.value = null;
  }
}
const sharedDirty = computed(() => (m.value?.sharedNotes ?? '') !== notes.shared);
const privateDirty = computed(() => (m.value?.managerNotes ?? '') !== notes.private);

const topics = computed(() => (m.value?.items ?? []).filter((i) => i.kind === 'TOPIC'));
const actions = computed(() => (m.value?.items ?? []).filter((i) => i.kind === 'ACTION'));
const newTopic = ref('');
const newAction = reactive({ text: '', owner: null as string | null, due: undefined as string | undefined });
const ownerOptions = computed(() => (m.value ? [{ value: m.value.employee.id, label: m.value.employee.name }, { value: m.value.manager.id, label: m.value.manager.name }] : []));
async function addTopic() {
  if (newTopic.value.trim().length < 2) return;
  await act('topic', () => performanceApi.addOneOnOneItem(id.value, { kind: 'TOPIC', text: newTopic.value.trim() }));
  newTopic.value = '';
}
async function addAction() {
  if (newAction.text.trim().length < 2) return;
  await act('action', () => performanceApi.addOneOnOneItem(id.value, { kind: 'ACTION', text: newAction.text.trim(), ownerEmployeeId: newAction.owner, dueDate: newAction.due ?? null }));
  Object.assign(newAction, { text: '', owner: null, due: undefined });
}
const toggle = (i: OneOnOneItem, done: boolean) => act(`item-${i.id}`, () => performanceApi.updateOneOnOneItem(i.id, { done }));
const canRemove = (i: OneOnOneItem) => m.value?.status === 'SCHEDULED' && (i.addedByMe || !!m.value?.viewer.isManager);
const removeItem = (i: OneOnOneItem) => act(`item-${i.id}`, () => performanceApi.removeOneOnOneItem(i.id));

const moveOpen = ref(false);
const completeOpen = ref(false);
const next = reactive({ book: true, date: undefined as string | undefined, time: '10:00' as string | number | null });
function openComplete() {
  const at = new Date(m.value!.scheduledAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  Object.assign(next, { book: true, date: addDaysIso(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, 14), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` });
  completeOpen.value = true;
}
const openItems = computed(() => (m.value?.items ?? []).filter((i) => !i.done).length);
async function complete() {
  completeOpen.value = false;
  if (sharedDirty.value || privateDirty.value) await act('notes', () => performanceApi.updateOneOnOne(id.value, { sharedNotes: notes.shared || null, ...(m.value!.viewer.isManager ? { managerNotes: notes.private || null } : {}) }));
  const nextAt = next.book && next.date && next.time ? new Date(`${next.date}T${next.time}`).toISOString() : null;
  busy.value = 'complete';
  try {
    const done = await performanceApi.completeOneOnOne(id.value, nextAt);
    meeting.data.value = done;
    feedback.success('1:1 marked as held', done.next ? `The next one is booked for ${formatDateTime(done.next.scheduledAt)}.` : undefined);
    if (done.next) void router.push(`/me/performance/one-on-ones/${done.next.id}`);
  } catch (e) {
    feedback.error('Could not complete the 1:1', e);
  } finally {
    busy.value = null;
  }
}
async function cancel() {
  if (!(await feedback.confirm({ title: 'Cancel this 1:1?', message: `${m.value!.employee.name} is notified.`, confirmLabel: 'Cancel 1:1', danger: true }))) return;
  await act('cancel', () => performanceApi.cancelOneOnOne(id.value), '1:1 cancelled');
}
</script>

<template>
  <div>
    <AppSkeleton v-if="meeting.loading.value && !m" :lines="8" />
    <AppErrorState v-else-if="meeting.error.value" :error="meeting.error.value" title="This 1:1 isn't available" @retry="meeting.run" />
    <template v-else-if="m && other">
      <AppPageHeader :title="`1:1 with ${other.name}`" :description="`${fmt.format(new Date(m.scheduledAt))} · ${m.durationMinutes} minutes`" back="/me/performance/one-on-ones" back-label="1:1s">
        <template #leading><AppAvatar :name="other.name" size="xl" /></template>
        <template #badges>
          <AppBadge v-if="m.overdue" tone="danger">Past due</AppBadge>
          <AppBadge v-else :tone="oneOnOneTone[m.status]" dot>{{ ONE_ON_ONE_STATUS_LABELS[m.status] }}</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="m.permissions.cancel" variant="ghost" :icon="CalendarX2" :loading="busy === 'cancel'" @click="cancel">Cancel</AppButton>
          <AppButton v-if="m.permissions.reschedule" variant="secondary" :icon="CalendarClock" @click="moveOpen = true">Move</AppButton>
          <AppButton v-if="m.permissions.complete" :icon="CheckCircle2" :loading="busy === 'complete'" @click="openComplete">Mark as held</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="m.status === 'CANCELLED'" tone="info" class="mb-4">This 1:1 was cancelled.</AppAlert>
      <AppAlert v-else-if="m.overdue && m.viewer.isManager" tone="warning" class="mb-4" title="This 1:1 was due">Mark it as held (and book the next one), move it, or cancel it.</AppAlert>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div class="min-w-0 space-y-4">
          <AppCard title="Agenda" :icon="MessagesSquare" :description="m.status === 'SCHEDULED' ? 'Both of you can add topics. Tick them off as you talk.' : 'What you talked about'" :padded="false">
            <ul v-if="topics.length" class="divide-y divide-line/70">
              <li v-for="t in topics" :key="t.id" class="flex items-center gap-3 px-4 py-2.5">
                <AppCheckbox :model-value="t.done" :label="t.text" :disabled="!m.permissions.addItems || busy === `item-${t.id}`" :class="t.done && 'line-through decoration-fg-subtle'" @update:model-value="(v: boolean) => toggle(t, v)" />
                <span class="ms-auto text-2xs text-fg-subtle">{{ t.addedByMe ? 'You' : other.name.split(' ')[0] }}</span>
                <AppButton v-if="canRemove(t)" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${t.text}`" @click="removeItem(t)" />
              </li>
            </ul>
            <p v-else class="px-4 py-4 text-sm text-fg-muted">No topics yet.</p>
            <form v-if="m.permissions.addItems" class="flex gap-2 border-t border-line/70 bg-surface-muted/30 px-4 py-3" @submit.prevent="addTopic">
              <AppInput v-model="newTopic" class="flex-1" aria-label="New topic" placeholder="Add a topic…" :maxlength="500" />
              <AppButton type="submit" variant="secondary" :icon="Plus" :loading="busy === 'topic'" :disabled="newTopic.trim().length < 2">Add</AppButton>
            </form>
          </AppCard>

          <AppCard title="Actions" :icon="ListTodo" description="Follow-ups agreed in the conversation. Open ones carry over to the next 1:1." :padded="false">
            <ul v-if="actions.length" class="divide-y divide-line/70">
              <li v-for="a in actions" :key="a.id" class="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <AppCheckbox :model-value="a.done" :label="a.text" :disabled="!m.permissions.addItems || busy === `item-${a.id}`" :class="a.done && 'line-through decoration-fg-subtle'" @update:model-value="(v: boolean) => toggle(a, v)" />
                <span class="ms-auto flex items-center gap-2 text-2xs text-fg-muted">
                  <span v-if="a.owner" class="inline-flex items-center gap-1"><AppAvatar :name="a.owner.name ?? '?'" size="xs" />{{ a.owner.name }}</span>
                  <span v-if="a.dueDate">due {{ formatDate(a.dueDate) }}</span>
                </span>
                <AppButton v-if="canRemove(a)" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${a.text}`" @click="removeItem(a)" />
              </li>
            </ul>
            <p v-else class="px-4 py-4 text-sm text-fg-muted">No actions yet.</p>
            <form v-if="m.permissions.addItems" class="grid gap-2 border-t border-line/70 bg-surface-muted/30 px-4 py-3 sm:grid-cols-[1fr_11rem_10rem_auto]" @submit.prevent="addAction">
              <AppInput v-model="newAction.text" aria-label="New action" placeholder="Add an action…" :maxlength="500" />
              <AppSelect v-model="newAction.owner" aria-label="Who does it" :options="ownerOptions" placeholder="Owner" />
              <AppDatePicker v-model="newAction.due" aria-label="Due date" placeholder="Due" />
              <AppButton type="submit" variant="secondary" :icon="Plus" :loading="busy === 'action'" :disabled="newAction.text.trim().length < 2">Add</AppButton>
            </form>
          </AppCard>

          <AppCard title="Shared notes" :icon="NotebookPen" description="Visible to both of you.">
            <AppTextarea v-model="notes.shared" aria-label="Shared notes" :rows="6" :maxlength="20000" :disabled="!m.permissions.editNotes" placeholder="Key points, decisions, how they're feeling…" />
            <div v-if="m.permissions.editNotes" class="mt-2 flex justify-end">
              <AppButton size="sm" :disabled="!sharedDirty" :loading="busy === 'shared'" @click="act('shared', () => performanceApi.updateOneOnOne(id, { sharedNotes: notes.shared || null }), 'Notes saved')">Save notes</AppButton>
            </div>
          </AppCard>
        </div>

        <aside class="space-y-4">
          <AppCard v-if="m.viewer.isManager" title="Private notes" :icon="Lock" description="Only you can see these.">
            <AppTextarea v-model="notes.private" aria-label="Private notes" :rows="5" :maxlength="20000" :disabled="!m.permissions.editNotes" placeholder="Observations, coaching ideas, things to follow up…" />
            <div v-if="m.permissions.editNotes" class="mt-2 flex justify-end">
              <AppButton size="sm" variant="secondary" :disabled="!privateDirty" :loading="busy === 'private'" @click="act('private', () => performanceApi.updateOneOnOne(id, { managerNotes: notes.private || null }), 'Private notes saved')">Save</AppButton>
            </div>
          </AppCard>

          <AppCard title="People" :icon="UsersRound">
            <ul class="space-y-3">
              <li v-for="p in [{ ...m.manager, role: 'Manager' }, { ...m.employee, role: m.employee.department ?? 'Employee' }]" :key="p.id" class="flex items-center gap-3">
                <AppAvatar :name="p.name" size="md" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-fg">{{ p.name }}</p>
                  <p class="truncate text-xs text-fg-muted">{{ p.role }}</p>
                </div>
              </li>
            </ul>
          </AppCard>

          <AppCard v-if="m.previous || m.completedAt" title="History" :icon="History">
            <p v-if="m.completedAt" class="text-sm text-fg">Held · marked {{ formatDateTime(m.completedAt) }}</p>
            <AppButton v-if="m.previous" class="mt-1" size="sm" variant="link" :to="`/me/performance/one-on-ones/${m.previous.id}`">Previous 1:1 · {{ formatDate(m.previous.scheduledAt) }}</AppButton>
          </AppCard>
        </aside>
      </div>

      <ScheduleOneOnOneModal :open="moveOpen" :meeting="m" @close="moveOpen = false" @saved="(x) => { meeting.data.value = x; moveOpen = false; feedback.success('1:1 moved'); }" />

      <AppModal :open="completeOpen" title="Mark the 1:1 as held" size="sm" @close="completeOpen = false">
        <div class="space-y-4">
          <AppCheckbox v-model="next.book" label="Book the next 1:1" />
          <div v-if="next.book" class="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <AppDatePicker v-model="next.date" label="Date" required />
            <AppInput v-model="next.time" type="time" label="Time" required />
          </div>
          <p class="text-sm text-fg-muted">
            <template v-if="next.book && openItems">{{ openItems }} open topic{{ openItems === 1 ? '' : 's' }} and action{{ openItems === 1 ? '' : 's' }} move to the next 1:1.</template>
            <template v-else>{{ m.employee.name }} is told the notes are ready.</template>
          </p>
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="completeOpen = false">Cancel</AppButton>
          <AppButton :icon="CheckCircle2" :disabled="next.book && (!next.date || !next.time)" @click="complete">Mark as held</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
