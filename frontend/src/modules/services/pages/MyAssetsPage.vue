<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Ban, CircleCheck, PackageCheck, PackageOpen, Plus } from '@lucide/vue';
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, type AssetCategory } from '@contracts';
import { assetsApi } from '@/modules/services/api/services.api';
import type { MyAssets } from '@/modules/services/types';
import { ASSET_CONDITION_LABELS, ASSET_ICONS, ASSET_REQUEST_STATUS_LABELS, assetRequestTone } from '@/modules/services/utils/services-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Company equipment you hold — confirm what you received — and requests for something new. */
const feedback = useFeedbackStore();
const mine = useAsync(() => assetsApi.mine());
const assets = computed(() => mine.data.value?.assets ?? []);
const unconfirmed = computed(() => assets.value.filter((a) => a.assignmentId && !a.acknowledgedAt));

const confirming = ref<string | null>(null);
async function confirm(a: MyAssets['assets'][number]) {
  confirming.value = a.id;
  try {
    mine.data.value = await assetsApi.acknowledge(a.assignmentId!);
    feedback.success('Thanks for confirming', `${a.name} (${a.tag}) is recorded as received.`);
  } catch (e) {
    feedback.error('Could not confirm it', e);
  } finally {
    confirming.value = null;
  }
}

const asking = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ category: 'LAPTOP' as AssetCategory, reason: '' });
const categoryOptions = ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABELS[c] }));
function openRequest() {
  reset();
  Object.assign(form, { category: 'LAPTOP', reason: '' });
  asking.value = true;
}
const sending = ref(false);
async function send() {
  reset();
  sending.value = true;
  try {
    mine.data.value = await assetsApi.request({ category: form.category, reason: form.reason });
    asking.value = false;
    feedback.success('Request sent', 'The team that manages assets will get back to you.');
  } catch (e) {
    handle(e, 'Could not send the request');
  } finally {
    sending.value = false;
  }
}
async function cancel(id: string) {
  if (!(await feedback.confirm({ title: 'Withdraw this request?', message: 'You can ask again later.', confirmLabel: 'Withdraw' }))) return;
  try {
    mine.data.value = await assetsApi.cancelRequest(id);
    feedback.success('Request withdrawn');
  } catch (e) {
    feedback.error('Could not withdraw it', e);
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My assets" description="Equipment the company has given you. Confirm what you received, and ask for anything you need for work.">
      <template #actions><AppButton :icon="Plus" :disabled="!mine.data.value?.canRequest" @click="openRequest">Request an asset</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="5" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="mine.data.value">
      <AppAlert v-if="unconfirmed.length" tone="info" :title="`Confirm you received ${unconfirmed.length === 1 ? 'this item' : `${unconfirmed.length} items`}`">
        Check the item and its tag, then confirm below. Tell HR straight away if something is missing or damaged.
      </AppAlert>

      <section v-if="assets.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Assets you hold">
        <article v-for="a in assets" :key="a.id" class="card flex flex-col overflow-hidden">
          <div class="flex items-start gap-3 p-4">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg ring-1 ring-accent-fg/10 ring-inset" aria-hidden="true"><component :is="ASSET_ICONS[a.category]" :size="20" /></span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold text-fg">{{ a.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ ASSET_CATEGORY_LABELS[a.category] }} · <span class="font-mono">{{ a.tag }}</span></p>
            </div>
          </div>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line/70 px-4 py-3 text-xs">
            <div>
              <dt class="text-fg-muted">With you since</dt>
              <dd class="font-medium text-fg">{{ formatDate(a.assignedAt) }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Condition when given</dt>
              <dd class="font-medium text-fg">{{ a.conditionOut ? ASSET_CONDITION_LABELS[a.conditionOut] : '—' }}</dd>
            </div>
            <div v-if="a.serialNumber" class="col-span-2">
              <dt class="text-fg-muted">Serial number</dt>
              <dd class="truncate font-mono text-fg">{{ a.serialNumber }}</dd>
            </div>
          </dl>
          <div class="mt-auto border-t border-line/70 bg-surface-muted/40 px-4 py-2.5">
            <p v-if="a.acknowledgedAt" class="flex items-center gap-1.5 text-xs text-success-fg"><CircleCheck :size="14" aria-hidden="true" />Received {{ formatDate(a.acknowledgedAt) }}</p>
            <AppButton v-else-if="a.assignmentId" size="sm" :icon="PackageCheck" :loading="confirming === a.id" @click="confirm(a)">Confirm I received it</AppButton>
          </div>
        </article>
      </section>
      <section v-else class="card flex flex-wrap items-center gap-5 p-5">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted" aria-hidden="true"><PackageOpen :size="22" /></span>
        <div class="min-w-0 flex-1">
          <p class="text-lg font-semibold text-fg">No company assets with you</p>
          <p class="text-sm text-fg-muted">Laptops, phones, ID cards and other equipment assigned to you appear here.</p>
        </div>
        <AppButton v-if="mine.data.value.canRequest" variant="secondary" :icon="Plus" @click="openRequest">Request an asset</AppButton>
      </section>

      <AppCard title="Your requests" :padded="false">
        <ul v-if="mine.data.value.requests.length" class="divide-y divide-line/70">
          <li v-for="r in mine.data.value.requests" :key="r.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="ASSET_ICONS[r.category]" :size="16" /></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ ASSET_CATEGORY_LABELS[r.category] }}<span v-if="r.asset" class="font-normal text-fg-muted"> · {{ r.asset.name }} ({{ r.asset.tag }})</span></p>
              <p class="truncate text-xs text-fg-muted">{{ r.reason }} · asked {{ timeAgo(r.createdAt) }}</p>
              <p v-if="r.reviewNote" class="mt-0.5 truncate text-xs text-fg-subtle">“{{ r.reviewNote }}”</p>
            </div>
            <AppBadge :tone="assetRequestTone[r.status]" size="sm" dot>{{ ASSET_REQUEST_STATUS_LABELS[r.status] }}</AppBadge>
            <AppButton v-if="r.permissions.cancel" size="sm" variant="ghost" :icon="Ban" @click="cancel(r.id)">Withdraw</AppButton>
          </li>
        </ul>
        <p v-else class="px-4 py-6 text-center text-sm text-fg-muted">Requests you make appear here.</p>
      </AppCard>
    </template>

    <AppModal :open="asking" dialog title="Request an asset" description="Say what you need and why; it's handed over from stock when available." @close="asking = false">
      <form id="asset-request-form" class="space-y-4" novalidate @submit.prevent="send">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppSelect v-model="form.category" label="What do you need?" :options="categoryOptions" :clearable="false" />
        <AppTextarea v-model="form.reason" label="Why do you need it?" required :rows="3" :maxlength="500" :error="fieldErrors.reason" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="asking = false">Cancel</AppButton>
        <AppButton type="submit" form="asset-request-form" :loading="sending" :disabled="form.reason.trim().length < 3">Send request</AppButton>
      </template>
    </AppModal>
  </div>
</template>
