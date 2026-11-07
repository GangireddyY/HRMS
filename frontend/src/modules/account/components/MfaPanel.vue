<script setup lang="ts">
import { ref } from 'vue';
import { Copy, Download, RefreshCw, ShieldCheck, ShieldOff } from '@lucide/vue';
import { authApi } from '@/modules/auth/api/auth.api';
import type { MfaSetup } from '@/modules/auth/types';
import { AppAlert, AppBadge, AppButton, AppErrorState, AppInput, AppModal, AppOtpInput, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const status = useAsync(() => authApi.mfaStatus());
const { formError, handle, reset } = useFormErrors();

const mode = ref<'setup' | 'disable' | 'regenerate' | 'codes' | null>(null);
const setup = ref<MfaSetup | null>(null);
const code = ref('');
const password = ref('');
const recoveryCodes = ref<string[]>([]);
const busy = ref(false);

function close() {
  mode.value = null;
  code.value = '';
  password.value = '';
  setup.value = null;
  reset();
}

async function startSetup() {
  reset();
  busy.value = true;
  try {
    setup.value = await authApi.mfaSetup();
    mode.value = 'setup';
  } catch (e) {
    feedback.error('Could not start setup', e);
  } finally {
    busy.value = false;
  }
}

async function run(action: () => Promise<void>) {
  reset();
  busy.value = true;
  try {
    await action();
  } catch (e) {
    handle(e);
  } finally {
    busy.value = false;
  }
}

const enable = () =>
  run(async () => {
    recoveryCodes.value = (await authApi.mfaEnable(code.value)).recoveryCodes;
    code.value = '';
    mode.value = 'codes';
    await Promise.all([status.run(), auth.loadContext()]);
    feedback.success('Two-factor authentication enabled');
  });

const disable = () =>
  run(async () => {
    await authApi.mfaDisable(password.value, code.value);
    close();
    await Promise.all([status.run(), auth.loadContext()]);
    feedback.success('Two-factor authentication disabled');
  });

const regenerate = () =>
  run(async () => {
    recoveryCodes.value = (await authApi.regenerateRecoveryCodes(code.value)).recoveryCodes;
    code.value = '';
    mode.value = 'codes';
    await status.run();
  });

async function copyCodes() {
  try {
    await navigator.clipboard.writeText(recoveryCodes.value.join('\n'));
    feedback.success('Recovery codes copied');
  } catch (e) {
    feedback.error('Could not copy to clipboard', e);
  }
}

function downloadCodes() {
  const blob = new Blob([`HRMS recovery codes for ${auth.user?.email}\nEach code can be used once.\n\n${recoveryCodes.value.join('\n')}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'hrms-recovery-codes.txt' });
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div>
    <AppSkeleton v-if="status.loading.value && !status.data.value" :lines="2" />
    <AppErrorState v-else-if="status.error.value" :error="status.error.value" @retry="status.run" />
    <div v-else-if="status.data.value" class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-start gap-3">
        <div :class="['flex h-10 w-10 items-center justify-center rounded-lg', status.data.value.enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-surface-muted text-fg-subtle']">
          <ShieldCheck v-if="status.data.value.enabled" :size="20" />
          <ShieldOff v-else :size="20" />
        </div>
        <div>
          <p class="text-sm font-medium text-fg">
            Authenticator app
            <AppBadge v-if="status.data.value.enabled" tone="success" class="ms-1">Enabled</AppBadge>
            <AppBadge v-else-if="status.data.value.required" tone="warning" class="ms-1">Required</AppBadge>
          </p>
          <p class="text-xs text-fg-muted">
            <template v-if="status.data.value.enabled">{{ status.data.value.recoveryCodesRemaining }} recovery codes remaining.</template>
            <template v-else>Use an app such as Microsoft Authenticator, Google Authenticator or 1Password.</template>
          </p>
        </div>
      </div>
      <div class="flex gap-2">
        <template v-if="status.data.value.enabled">
          <AppButton variant="secondary" size="sm" :icon="RefreshCw" @click="mode = 'regenerate'">New recovery codes</AppButton>
          <AppButton v-if="!status.data.value.required" variant="secondary" size="sm" @click="mode = 'disable'">Disable</AppButton>
        </template>
        <AppButton v-else size="sm" :loading="busy" @click="startSetup">Set up two-factor</AppButton>
      </div>
    </div>

    <AppModal :open="mode === 'setup'" title="Set up two-factor authentication" @close="close">
      <div v-if="setup" class="space-y-4">
        <ol class="list-decimal space-y-1 ps-5 text-sm text-fg-muted">
          <li>Scan this QR code with your authenticator app.</li>
          <li>Enter the 6-digit code it shows to confirm.</li>
        </ol>
        <div class="flex justify-center rounded-xl bg-white p-4"><img :src="setup.qrCodeDataUrl" alt="QR code for authenticator setup" class="h-44 w-44" /></div>
        <p class="text-center text-xs text-fg-muted">Can't scan? Enter this key manually:<br /><code class="font-mono text-sm break-all text-fg select-all">{{ setup.secret }}</code></p>
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppOtpInput v-model="code" label="Verification code" autofocus />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="close">Cancel</AppButton>
        <AppButton :loading="busy" :disabled="code.length !== 6" @click="enable">Verify &amp; enable</AppButton>
      </template>
    </AppModal>

    <AppModal :open="mode === 'disable'" title="Disable two-factor authentication" description="Your account will be protected by password only." size="sm" @close="close">
      <div class="space-y-4">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="password" label="Current password" type="password" autocomplete="current-password" />
        <AppOtpInput v-model="code" label="Authenticator code" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="close">Cancel</AppButton>
        <AppButton variant="danger" :loading="busy" :disabled="!password || code.length !== 6" @click="disable">Disable</AppButton>
      </template>
    </AppModal>

    <AppModal :open="mode === 'regenerate'" title="Generate new recovery codes" description="Your existing recovery codes will stop working." size="sm" @close="close">
      <div class="space-y-4">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppOtpInput v-model="code" label="Authenticator code" autofocus />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="close">Cancel</AppButton>
        <AppButton :loading="busy" :disabled="code.length !== 6" @click="regenerate">Generate</AppButton>
      </template>
    </AppModal>

    <AppModal :open="mode === 'codes'" title="Save your recovery codes" description="Each code works once. Store them somewhere safe — they won't be shown again." :dismissible="false" @close="close">
      <ul class="grid grid-cols-2 gap-2 rounded-xl bg-surface-muted p-4 font-mono text-sm" aria-label="Recovery codes">
        <li v-for="c in recoveryCodes" :key="c" class="text-center text-fg">{{ c }}</li>
      </ul>
      <template #footer>
        <AppButton variant="secondary" :icon="Copy" @click="copyCodes">Copy</AppButton>
        <AppButton variant="secondary" :icon="Download" @click="downloadCodes">Download</AppButton>
        <AppButton @click="close">I've saved them</AppButton>
      </template>
    </AppModal>
  </div>
</template>
