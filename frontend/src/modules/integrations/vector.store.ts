import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import type { VectorConnectorSettings } from '@/modules/integrations/types';

export type VectorWorkspaceSession = { url: string; title: string };

const SESSION_KEY = 'hrms.vector.workspace';

function readSession(): VectorWorkspaceSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VectorWorkspaceSession;
    if (parsed?.url && parsed?.title) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function writeSession(session: VectorWorkspaceSession | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Org Vector embed connector — drives the sidebar item and workspace page. */
export const useVectorStore = defineStore('vector', () => {
  const settings = ref<VectorConnectorSettings | null>(null);
  const available = ref(false);
  const orgLabel = ref<string | null>(null);
  const loaded = ref(false);
  /** Open workspace; kept across HRMS navigation until the user closes it. */
  const workspace = ref<VectorWorkspaceSession | null>(readSession());

  /** Sidebar uses this: true when the current person may open Vector. */
  const connected = computed(() => available.value);

  async function refresh() {
    try {
      const status = await integrationsApi.vectorStatus();
      available.value = status.available;
      orgLabel.value = status.vectorOrgName;
      if (!status.available) closeWorkspace();
    } catch {
      available.value = false;
      orgLabel.value = null;
      closeWorkspace();
    } finally {
      loaded.value = true;
    }
  }

  /** After an admin saves connector settings (live only when Vector Access is on). */
  function apply(next: VectorConnectorSettings | null) {
    settings.value = next;
    if (next?.configured && next.enabled && next.remoteStatus === 'live') {
      available.value = true;
      orgLabel.value = next.vectorOrgName;
    } else {
      available.value = false;
      orgLabel.value = next?.vectorOrgName ?? null;
      closeWorkspace();
    }
    loaded.value = true;
  }

  function openWorkspace(session: VectorWorkspaceSession) {
    workspace.value = session;
    writeSession(session);
  }

  function closeWorkspace() {
    workspace.value = null;
    writeSession(null);
  }

  function clear() {
    settings.value = null;
    available.value = false;
    orgLabel.value = null;
    loaded.value = false;
    closeWorkspace();
  }

  return {
    settings,
    available,
    loaded,
    connected,
    orgLabel,
    workspace,
    refresh,
    apply,
    openWorkspace,
    closeWorkspace,
    clear,
  };
});
