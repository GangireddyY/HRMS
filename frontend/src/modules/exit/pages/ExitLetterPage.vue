<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Printer } from '@lucide/vue';
import { exitApi } from '@/modules/exit/api/exit.api';
import LetterDocument from '@/modules/exit/components/LetterDocument.vue';
import { LETTER_LABELS } from '@/modules/exit/utils/exit-format';
import { AppAlert, AppButton, AppCard, AppErrorState, AppFacts, AppPageHeader, AppSkeleton, AppSplit } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** One exit letter, printable (browser "Save as PDF"). Used from the exit page (HR) and My Workspace. */
const route = useRoute();
const ids = computed(() => ({ id: String(route.params.id), letterId: String(route.params.letterId) }));
const letter = useAsync(() => exitApi.letter(ids.value.id, ids.value.letterId));
watch(ids, () => void letter.run());
const hr = computed(() => route.path.startsWith('/hr'));
const print = () => window.print();
</script>

<template>
  <div>
    <AppPageHeader
      class="print:hidden"
      :title="letter.data.value ? `${LETTER_LABELS[letter.data.value.type]} · ${letter.data.value.reference}` : 'Letter'"
      :description="letter.data.value?.employee.name"
      :back="hr ? `/hr/exits/${ids.id}` : '/me/exit'"
      :back-label="hr ? 'Exit' : 'Resignation & exit'"
    >
      <template #actions><AppButton variant="secondary" :icon="Printer" :disabled="!letter.data.value" @click="print">Print / save as PDF</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="letter.loading.value && !letter.data.value" :lines="12" />
    <AppErrorState v-else-if="letter.error.value" :error="letter.error.value" title="This letter isn't available" @retry="letter.run" />
    <AppSplit v-else-if="letter.data.value">
      <AppAlert v-if="letter.data.value.revokedAt" tone="warning" class="print:hidden">
        Revoked by {{ letter.data.value.revokedBy }} on {{ formatDate(letter.data.value.revokedAt) }}: {{ letter.data.value.revokedReason }}
      </AppAlert>
      <LetterDocument :letter="letter.data.value" />
      <template #aside>
        <AppCard title="Letter details">
          <AppFacts
            :items="[
              { label: 'Type', value: LETTER_LABELS[letter.data.value.type] },
              { label: 'Reference', value: letter.data.value.reference, mono: true },
              { label: 'Dated', value: formatDate(letter.data.value.letterDate) },
              { label: 'Employee', value: `${letter.data.value.employee.name} (${letter.data.value.employee.employeeCode})` },
              { label: 'Signed by', value: letter.data.value.signatoryName },
              { label: 'Issued by', value: letter.data.value.issuedBy },
              { label: 'Issued on', value: formatDate(letter.data.value.issuedAt) },
              { label: 'Status', value: letter.data.value.revokedAt ? 'Revoked' : 'Valid', strong: true },
            ]"
          />
        </AppCard>
        <AppButton block variant="secondary" :icon="Printer" @click="print">Print / save as PDF</AppButton>
      </template>
    </AppSplit>
  </div>
</template>
