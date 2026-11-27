import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import type { VectorConnectorSettings } from '@/modules/integrations/types';

/** Org Vector embed connector — drives the sidebar item and workspace page. */
export const useVectorStore = defineStore('vector', () => {
  const settings = ref<VectorConnectorSettings | null>(null);
  const available = ref(false);
  const orgLabel = ref<string | null>(null);
  const loaded = ref(false);

  /** Sidebar uses this: true when the current person may open Vector. */
  const connected = computed(() => available.value);

  async function refresh() {
    try {
      const status = await integrationsApi.vectorStatus();
      available.value = status.available;
      orgLabel.value = status.vectorOrgName;
    } catch {
      available.value = false;
      orgLabel.value = null;
    } finally {
      loaded.value = true;
    }
  }

  /** After an admin saves connector settings (they always have access when enabled). */
  function apply(next: VectorConnectorSettings | null) {
    settings.value = next;
    if (next?.configured && next.enabled) {
      available.value = true;
      orgLabel.value = next.vectorOrgName;
    } else {
      available.value = false;
      orgLabel.value = null;
    }
    loaded.value = true;
  }

  function clear() {
    settings.value = null;
    available.value = false;
    orgLabel.value = null;
    loaded.value = false;
  }

  return { settings, available, loaded, connected, orgLabel, refresh, apply, clear };
});
