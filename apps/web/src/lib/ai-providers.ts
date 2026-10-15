import type { AiProvider } from "@ankileet/core";

export type KnownAiProvider = Exclude<AiProvider, "">;

/**
 * The providers a user can bring a key for, in display order. Models are not
 * listed here: the server picks the analysis model from the provider's own
 * model list (server/ai-model-choice.ts).
 */
export const AI_PROVIDERS: readonly {
  id: KnownAiProvider;
  name: string;
  /** Where the provider's console issues API keys. */
  keyUrl: string;
  keyPlaceholder: string;
}[] = [
  { id: "deepseek", name: "DeepSeek", keyUrl: "https://platform.deepseek.com/api_keys", keyPlaceholder: "sk-..." },
  { id: "openai", name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-proj-..." },
  { id: "anthropic", name: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-..." },
  { id: "google", name: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey", keyPlaceholder: "AIza..." },
];

export function aiProviderName(id: AiProvider) {
  return AI_PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
}
