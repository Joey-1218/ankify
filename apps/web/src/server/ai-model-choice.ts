import type { AiProvider } from "@ankileet/core";
import { safeErrorForLog } from "./ai-errors";
import { isQaProfile } from "./qa";
import { updateAiModel, type AiRuntimeSettings } from "./settings";

/**
 * ankileet picks the analysis model; users only choose a provider and add a
 * key. Each provider's own model list is read with the user's key and ranked
 * by family rules (the fast, inexpensive tier), so a newly released model is
 * picked up without a code change. The fallback ids are used only when the
 * list can't be read or nothing in it matches a rule.
 */

export type ModelProvider = Exclude<AiProvider, "">;

export type ModelEntry = {
  id: string;
  label?: string;
  /** Release time in seconds, when the provider reports one. */
  createdAt?: number;
};

const MODEL_LIST_TIMEOUT_MS = 15_000;
/** How long a picked model is trusted before the worker reads the list again. */
export const MODEL_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many listed models are tried when a key is verified. */
const MAX_CANDIDATES = 3;

/** Verified with session analysis by `scripts/provider-smoke.ts`. */
export const FALLBACK_ANALYSIS_MODEL: Record<ModelProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-5.4-mini",
  deepseek: "deepseek-v4-flash",
  google: "gemini-3.5-flash",
};

export class ProviderError extends Error {
  constructor(readonly status: number) {
    super(`provider_${status}`);
  }
}

/** The provider's chat models for this key. Throws `ProviderError` on an HTTP error. */
export function listModels(provider: ModelProvider, apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  switch (provider) {
    case "anthropic":
      return listAnthropic(apiKey, signal);
    case "openai":
      return listOpenAi(apiKey, signal);
    case "deepseek":
      return listDeepseek(apiKey, signal);
    case "google":
      return listGoogle(apiKey, signal);
  }
}

/** Gemini models that can generate content, newest first. */
async function listGoogle(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const models: ModelEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { "x-goog-api-key": apiKey }, signal });
    // Gemini answers an invalid key with 400 API_KEY_INVALID, not 401.
    if (response.status === 400) throw new ProviderError(401);
    if (!response.ok) throw new ProviderError(response.status);
    const json = (await response.json()) as {
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      nextPageToken?: string;
    };
    for (const model of json.models ?? []) {
      const id = model.name.replace(/^models\//, "");
      if (id.startsWith("gemini-") && model.supportedGenerationMethods?.includes("generateContent")) {
        models.push({ id, label: model.displayName });
      }
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  models.sort((a, b) => b.id.localeCompare(a.id));
  return models;
}

async function listAnthropic(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
  });
  if (!response.ok) throw new ProviderError(response.status);

  const json = (await response.json()) as {
    data?: Array<{ id: string; display_name?: string; created_at?: string }>;
  };
  return (json.data ?? [])
    .filter((model) => model.id.startsWith("claude-"))
    .map((model) => {
      const created = model.created_at ? Date.parse(model.created_at) : NaN;
      return {
        id: model.id,
        label: model.display_name,
        ...(Number.isFinite(created) ? { createdAt: Math.floor(created / 1000) } : {}),
      };
    });
}

async function listOpenAi(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new ProviderError(response.status);

  const json = (await response.json()) as { data?: Array<{ id: string; created?: number }> };
  return (json.data ?? [])
    .filter((model) => isOpenAiChatModel(model.id))
    .map((model) => ({ id: model.id, ...(typeof model.created === "number" ? { createdAt: model.created } : {}) }));
}

async function listDeepseek(apiKey: string, signal: AbortSignal): Promise<ModelEntry[]> {
  // QA and browser tests point DeepSeek at a local fake provider (see ai.ts).
  const baseURL = (isQaProfile() && process.env.ANKILEET_QA_AI_BASE_URL) || "https://api.deepseek.com/v1";
  const response = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new ProviderError(response.status);

  const json = (await response.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((model) => ({ id: model.id }));
}

function isOpenAiChatModel(id: string) {
  const lower = id.toLowerCase();
  const blocklist = [
    "embed",
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "audio",
    "realtime",
    "image",
    "transcribe",
    "babbage",
    "davinci-edit",
    "instruct",
    "search",
  ];
  if (blocklist.some((keyword) => lower.includes(keyword))) return false;
  return lower.startsWith("gpt-") || lower.startsWith("chatgpt") || /^o\d/.test(lower);
}

/** The first version number in an id ("gpt-5.4-mini" -> [5, 4], "claude-haiku-4-5" -> [4, 5]). */
function versionOf(id: string): number[] {
  const match = id.match(/\d+(?:[.-]\d+)*/);
  if (!match) return [];
  // A trailing date stamp (20251001, 2026-01-15) is not part of the version.
  return match[0].split(/[.-]/).map(Number).filter((part) => part < 1000);
}

function compareVersionsDesc(a: string, b: string) {
  const va = versionOf(a);
  const vb = versionOf(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
    const diff = (vb[i] ?? 0) - (va[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const byCreatedDesc = (a: ModelEntry, b: ModelEntry) => (b.createdAt ?? 0) - (a.createdAt ?? 0);
/** Undated aliases ("gpt-5.4-mini") before their dated snapshots. */
const DATED = /-\d{4}-?\d{2}-?\d{2}$/;
const byUndatedFirst = (a: ModelEntry, b: ModelEntry) => Number(DATED.test(a.id)) - Number(DATED.test(b.id));

/**
 * The provider's fast-tier models for session analysis, best first. Rules
 * name model families, never single ids, so new releases rank without a
 * code change.
 */
export function rankAnalysisModels(provider: ModelProvider, models: readonly ModelEntry[]): string[] {
  const pick = (filter: (id: string) => boolean, compare: (a: ModelEntry, b: ModelEntry) => number) =>
    models.filter((model) => filter(model.id.toLowerCase())).sort(compare).map((model) => model.id);

  switch (provider) {
    case "anthropic":
      return pick(
        (id) => /^claude-.*haiku/.test(id),
        (a, b) => byCreatedDesc(a, b) || compareVersionsDesc(a.id, b.id) || byUndatedFirst(a, b),
      );
    case "openai":
      return pick(
        (id) => /^gpt-\d+(?:\.\d+)*o?-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(id),
        (a, b) => compareVersionsDesc(a.id, b.id) || byUndatedFirst(a, b) || byCreatedDesc(a, b),
      );
    case "google": {
      const byVersion = (a: ModelEntry, b: ModelEntry) => compareVersionsDesc(a.id, b.id) || a.id.localeCompare(b.id);
      const stable = pick((id) => /^gemini-\d+(?:\.\d+)*-flash(?:-\d{3})?$/.test(id), byVersion);
      return stable.length > 0 ? stable : pick((id) => /^gemini-\d+(?:\.\d+)*-flash-preview(?:-[\w-]+)?$/.test(id), byVersion);
    }
    case "deepseek":
      return [
        ...pick((id) => id.includes("flash"), (a, b) => compareVersionsDesc(a.id, b.id)),
        ...pick((id) => id === "deepseek-chat", () => 0),
      ];
  }
}

export type ModelCandidates =
  | { ok: true; candidates: string[] }
  | { ok: false; code: string; message: string };

/**
 * The models to try for a key, best first: up to three ranked from the
 * provider's list, or the fallback when the list can't be read or nothing
 * matches. A key the provider rejects while listing fails here.
 */
export async function resolveAnalysisModels(provider: ModelProvider, apiKey: string, signal?: AbortSignal): Promise<ModelCandidates> {
  const listed = await listModelsWithTimeout(provider, apiKey, signal);
  if (!listed.ok) {
    if (listed.code === "invalid_api_key") return listed;
    return { ok: true, candidates: [FALLBACK_ANALYSIS_MODEL[provider]] };
  }
  const ranked = rankAnalysisModels(provider, listed.models).slice(0, MAX_CANDIDATES);
  return { ok: true, candidates: ranked.length > 0 ? ranked : [FALLBACK_ANALYSIS_MODEL[provider]] };
}

async function listModelsWithTimeout(
  provider: ModelProvider,
  apiKey: string,
  outer?: AbortSignal,
): Promise<{ ok: true; models: ModelEntry[] } | { ok: false; code: string; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  const abort = () => controller.abort();
  outer?.addEventListener("abort", abort, { once: true });
  try {
    return { ok: true, models: await listModels(provider, apiKey, controller.signal) };
  } catch (error) {
    console.warn("[ai-models] provider request failed", safeErrorForLog(error));
    return { ok: false, ...classifyListError(error) };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
  }
}

/**
 * The model the worker should run: the stored one while it was checked within
 * the last week, otherwise the current best from the provider's list (saved
 * for next time). `force` re-checks at once, after the provider stopped
 * accepting the stored model. A list that can't be read keeps the stored
 * model; the analysis call then reports any real problem.
 */
export async function ensureCurrentAnalysisModel(
  userId: string,
  ai: AiRuntimeSettings,
  opts: { force?: boolean; now?: Date } = {},
): Promise<AiRuntimeSettings> {
  const now = opts.now ?? new Date();
  const checkedAt = ai.modelCheckedAt ? Date.parse(ai.modelCheckedAt) : NaN;
  if (!opts.force && Number.isFinite(checkedAt) && now.getTime() - checkedAt < MODEL_CHECK_INTERVAL_MS) return ai;

  const listed = await listModelsWithTimeout(ai.provider, ai.apiKey);
  if (!listed.ok) return ai;
  const best = rankAnalysisModels(ai.provider, listed.models)[0];
  const model = best ?? (listed.models.some((entry) => entry.id === ai.model) ? ai.model : FALLBACK_ANALYSIS_MODEL[ai.provider]);
  const modelCheckedAt = now.toISOString();
  await updateAiModel(userId, { provider: ai.provider, model, modelCheckedAt });
  return { ...ai, model, modelCheckedAt };
}

/** The provider no longer serves this model id (retired or renamed). */
export function isModelNotFoundError(error: unknown) {
  const details = error as { status?: unknown; statusCode?: unknown; message?: unknown; responseBody?: unknown } | null;
  const status = typeof details?.statusCode === "number" ? details.statusCode : details?.status;
  if (status === 404) return true;
  const text = `${typeof details?.message === "string" ? details.message : ""} ${typeof details?.responseBody === "string" ? details.responseBody : ""}`;
  return /model[_ ]not[_ ]found|model not exist|model .*does not exist|unknown model|is not found for api version/i.test(text);
}

function classifyListError(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderError) {
    if (error.status === 401) {
      return { code: "invalid_api_key", message: "API key was rejected by the provider." };
    }
    if (error.status === 403) {
      return { code: "forbidden", message: "API key cannot list models." };
    }
    if (error.status === 429) {
      return { code: "quota_or_rate_limit", message: "Provider returned a rate limit error." };
    }
    return {
      code: `http_${error.status}`,
      message: `Provider returned HTTP ${error.status}.`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("aborted")) {
    return {
      code: "timeout",
      message: `Provider did not respond within ${MODEL_LIST_TIMEOUT_MS / 1000} seconds.`,
    };
  }
  return { code: "network", message: "Could not reach the provider." };
}
