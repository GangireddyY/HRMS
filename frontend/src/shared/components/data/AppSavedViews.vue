<script setup lang="ts">
import { ref } from 'vue';
import { Bookmark, BookmarkPlus, X } from '@lucide/vue';
import { t } from '@/core/i18n/i18n';
import AppButton from '@/shared/components/forms/AppButton.vue';
import AppInput from '@/shared/components/forms/AppInput.vue';
import AppDropdown from '@/shared/components/layout/AppDropdown.vue';
import AppModal from '@/shared/components/feedback/AppModal.vue';
import type { SavedView } from '@/shared/composables/use-table';

/** Saved views of a list (search, filters, sort): pick one, save the current one, delete. Pair with `useTable({ views })`. */
defineProps<{ views: SavedView[]; canSave: boolean }>();
const emit = defineEmits<{ apply: [name: string]; save: [name: string]; delete: [name: string] }>();
const naming = ref(false);
const name = ref('');
function save() {
  if (!name.value.trim()) return;
  emit('save', name.value);
  naming.value = false;
  name.value = '';
}
</script>

<template>
  <AppDropdown width="w-64" :label="t('table.views')">
    <template #trigger="{ toggle }">
      <AppButton size="sm" variant="secondary" :icon="Bookmark" @click="toggle">{{ t('table.views') }}</AppButton>
    </template>
    <p v-if="!views.length" class="px-2 py-1.5 text-xs text-fg-muted">No saved views yet. Filter the list, then save it here.</p>
    <div v-for="v in views" :key="v.name" class="group flex items-center gap-1">
      <button type="button" class="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-muted" @click="emit('apply', v.name)">{{ v.name }}</button>
      <button type="button" class="rounded-md p-1 text-fg-subtle hover:bg-surface-muted hover:text-danger-fg" :aria-label="t('table.deleteView', { name: v.name })" @click.stop="emit('delete', v.name)">
        <X :size="13" />
      </button>
    </div>
    <div v-if="canSave" class="mt-1 border-t border-line pt-1">
      <button type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-accent-fg hover:bg-surface-muted" @click="naming = true">
        <BookmarkPlus :size="14" aria-hidden="true" />{{ t('table.saveView') }}
      </button>
    </div>
  </AppDropdown>
  <AppModal :open="naming" :title="t('table.viewName')" size="sm" dialog @close="naming = false">
    <form id="saved-view-form" @submit.prevent="save"><AppInput v-model="name" label="Name" :maxlength="40" placeholder="e.g. Engineering on notice" /></form>
    <template #footer>
      <AppButton variant="secondary" @click="naming = false">{{ t('common.cancel') }}</AppButton>
      <AppButton type="submit" form="saved-view-form" :disabled="!name.trim()">{{ t('common.save') }}</AppButton>
    </template>
  </AppModal>
</template>
