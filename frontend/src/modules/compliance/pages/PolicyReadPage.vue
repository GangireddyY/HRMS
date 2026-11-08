<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, Download } from '@lucide/vue';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import { ACK_LABELS, POLICY_CATEGORY_LABELS, ackTone } from '@/modules/compliance/utils/compliance-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const policy = useAsync(() => complianceApi.read(id.value));
watch(id, () => void policy.run());
const p = computed(() => policy.data.value);
const confirmed = ref(false);
const busy = ref(false);
async function acknowledge() {
  if (!p.value) return;
  busy.value = true;
  try {
    policy.data.value = await complianceApi.acknowledge(p.value.id, p.value.version.id);
    feedback.success('Thanks — your acknowledgement is recorded');
  } catch (e) {
    feedback.error('Could not record your acknowledgement', e);
  } finally {
    busy.value = false;
  }
}
async function download() {
  if (!p.value?.version.file) return;
  try {
    await complianceApi.downloadVersion(p.value.id, p.value.version.id, p.value.version.file.name);
  } catch (e) {
    feedback.error('Could not download the document', e);
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="policy.loading.value && !p" :lines="10" />
    <AppErrorState v-else-if="policy.error.value" :error="policy.error.value" @retry="policy.run" />
    <template v-else-if="p">
      <AppPageHeader :title="p.title" :description="p.summary ?? undefined" back="/me/policies" back-label="Policies">
        <template #badges>
          <AppBadge>{{ POLICY_CATEGORY_LABELS[p.category] }}</AppBadge>
          <AppBadge>Version {{ p.version.version }}</AppBadge>
          <AppBadge v-if="p.mine" :tone="ackTone[p.mine.state]" dot>{{ ACK_LABELS[p.mine.state] }}</AppBadge>
        </template>
        <template v-if="p.version.file" #actions>
          <AppButton variant="secondary" :icon="Download" @click="download">{{ p.version.file.name }}</AppButton>
        </template>
      </AppPageHeader>
      <AppAlert v-if="p.version.changeSummary && p.version.version > 1" tone="info" class="mb-4" title="What changed in this version">{{ p.version.changeSummary }}</AppAlert>

      <AppCard :description="[p.version.effectiveFrom ? `In force from ${formatDate(p.version.effectiveFrom)}` : null, p.version.publishedBy ? `published by ${p.version.publishedBy}` : null].filter(Boolean).join(' · ') || undefined" title="Policy">
        <div v-if="p.version.content" class="max-w-3xl text-sm leading-relaxed whitespace-pre-line text-fg">{{ p.version.content }}</div>
        <p v-else class="text-sm text-fg-muted">This policy is in the attached document.</p>
        <template v-if="p.requiresAck && p.mine" #footer>
          <div v-if="p.canAcknowledge" class="flex flex-wrap items-center justify-between gap-3">
            <AppCheckbox v-model="confirmed" :label="`I have read and understood ${p.title} (version ${p.version.version})`" :description="p.mine.state === 'OVERDUE' ? `This was due on ${formatDate(p.mine.dueOn)}.` : `Please confirm by ${formatDate(p.mine.dueOn)}.`" />
            <AppButton :icon="CheckCircle2" :disabled="!confirmed" :loading="busy" @click="acknowledge">Acknowledge</AppButton>
          </div>
          <p v-else class="inline-flex items-center gap-2 text-sm text-success-fg">
            <CheckCircle2 :size="16" aria-hidden="true" />You acknowledged version {{ p.mine.acknowledgedVersion }} on {{ formatDateTime(p.mine.acknowledgedAt!) }}.
          </p>
        </template>
      </AppCard>
    </template>
  </div>
</template>
