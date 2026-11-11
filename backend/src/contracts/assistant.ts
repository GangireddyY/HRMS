/** The HRMS assistant: a language model answering from the person's own data through permission-checked tools. */

export const ASSISTANT_MAX_MESSAGES = 12;
export const ASSISTANT_MAX_MESSAGE_LENGTH = 2000;

export interface AssistantStatus {
  /** Answers come from the language model (the server has a provider and the organization turned it on). */
  ai: boolean;
  /** The server has a provider configured (an admin may turn it on). */
  available: boolean;
  /** The organization's switch. */
  enabled: boolean;
  /** The caller may turn it on or off for the organization. */
  canConfigure: boolean;
  model: string | null;
}

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** `fallback`: no model answer (off, unavailable or failed) — the app answers with its built-in keyword assistant. */
export type AssistantReplyView =
  | { mode: 'ai'; text: string; links: { label: string; to: string }[]; sources: string[] }
  | { mode: 'fallback'; reason: string };
