<script setup lang="ts">
import { ref } from 'vue';
import { Archive } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { auditApi } from '@/modules/audit/api/audit.api';
import AuditLogView from '@/modules/audit/components/AuditLogView.vue';
import LogArchiveModal from '@/modules/audit/components/LogArchiveModal.vue';
import { AppButton, AppPageHeader } from '@/shared/components';

const auth = useAuthStore();
const archiveOpen = ref(false);
/** Remounts the list after records were deleted. */
const listKey = ref(0);
</script>

<template>
  <div>
    <AppPageHeader title="Audit log" description="Append-only record of administrative and security events in this organization. Old entries can be archived to a file and then deleted.">
      <template #actions>
        <AppButton v-if="auth.can('audit.purge')" variant="secondary" :icon="Archive" @click="archiveOpen = true">Archive & delete</AppButton>
      </template>
    </AppPageHeader>
    <AuditLogView :key="listKey" :fetcher="auditApi.list" />
    <LogArchiveModal v-if="auth.can('audit.purge')" :open="archiveOpen" kind="AUDIT_LOG" @close="archiveOpen = false" @purged="listKey++" />
  </div>
</template>
