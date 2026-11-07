import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Reply } from './engine';

export interface AssistantMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: Reply;
  pending?: boolean;
}

/** The assistant panel and its conversation (kept while moving between pages and workspaces). */
export const useAssistantStore = defineStore('assistant', () => {
  const open = ref(false);
  const messages = ref<AssistantMessage[]>([]);
  let nextId = 1;
  const add = (m: Omit<AssistantMessage, 'id'>) => {
    const message = { ...m, id: nextId++ };
    messages.value.push(message);
    return message.id;
  };
  const update = (id: number, patch: Partial<AssistantMessage>) => {
    const i = messages.value.findIndex((m) => m.id === id);
    if (i >= 0) messages.value[i] = { ...messages.value[i]!, ...patch };
  };
  const clear = () => (messages.value = []);
  /** A question asked from elsewhere (e.g. global search); the panel opens and answers it. */
  const queued = ref<string | null>(null);
  const ask = (question: string) => {
    queued.value = question;
    open.value = true;
  };
  return { open, messages, add, update, clear, queued, ask };
});
