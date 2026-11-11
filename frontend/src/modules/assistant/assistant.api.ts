import type { AssistantChatMessage, AssistantReplyView, AssistantStatus } from '@contracts';
import { http } from '@/core/http/http-client';

export const assistantApi = {
  status: () => http.get<AssistantStatus>('/assistant/status'),
  setEnabled: (enabled: boolean) => http.put<AssistantStatus>('/assistant/settings', { enabled }),
  chat: (messages: AssistantChatMessage[]) => http.post<AssistantReplyView>('/assistant/chat', { messages }),
};
