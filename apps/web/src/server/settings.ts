import { getDb, schema } from "@ankileet/db";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import type { AnalysisSettings } from "@ankileet/contracts";
import { clampInitialReviewDelayHours, INITIAL_REVIEW_DELAY_HOURS, type AiProvider, type AiReasoningMode } from "@ankileet/core";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./secret-box";
import { readStarterAiConfig } from "./starter-ai";
import { isValidTimeZone, normalizeTimeZone } from "./time-zone";
import { DEFAULT_LANGUAGE, normalizeLanguage, type Language } from "@/lib/i18n";

interface AiSettings {
  provider: AiProvider;
  /** Picked by the server (ai-model-choice.ts), never by the user. */
  model: string;
  /** Always "fast": analysis runs with thinking off. */
  reasoningMode: AiReasoningMode;
  encryptedApiKey?: EncryptedSecret;
  /** When the model was last checked against the provider's list (ISO). */
  modelCheckedAt?: string;
}

export interface AiRuntimeSettings {
  provider: Exclude<AiProvider, "">;
  model: string;
  reasoningMode: AiReasoningMode;
  apiKey: string;
  /** "user" = the user's own key; "starter" = the server's starter-credit key. */
  source: "user" | "starter";
  /** Starter-credit allowance per user; only set when source is "starter". */
  starterLimit?: number;
  /** When the user's model was last checked (own key only). */
  modelCheckedAt?: string;
}

interface ReviewSettings {
  dailyReviewLimit: number;
  timeZone: string;
  timeZoneConfigured: boolean;
  /** Hours from completing initial learning to the first review (1-168). */
  initialReviewDelayHours: number;
}

interface GenerationSettings {
  language: Language;
}

const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "",
  model: "",
  reasoningMode: "fast",
};

const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  dailyReviewLimit: 20,
  timeZone: "UTC",
  timeZoneConfigured: false,
  initialReviewDelayHours: INITIAL_REVIEW_DELAY_HOURS.default,
};

const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  language: DEFAULT_LANGUAGE,
};

/** Automatic analysis is on unless the user turns it off; it needs the user's own key. */
const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  automatic: true,
};

const KEY_AI = "ai";
const KEY_REVIEW = "review";
const KEY_GENERATION = "generation";
const KEY_ANALYSIS = "analysis";

export async function getAiSettings(userId: string): Promise<AiSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_AI)));
  const row = rows[0];
  if (!row) return DEFAULT_AI_SETTINGS;
  const value = { ...DEFAULT_AI_SETTINGS, ...(row.value as Partial<AiSettings>) };
  // A stored "thinking" from before the mode was retired is ignored.
  return { ...value, reasoningMode: "fast" };
}

/**
 * The provider, model, and key an AI call should use. A user's own complete
 * configuration always wins; otherwise the server's starter-credit key is used
 * when it is configured. Callers that start new AI work must spend a starter
 * credit when `source` is "starter".
 */
export async function getAiRuntimeSettings(userId: string): Promise<AiRuntimeSettings> {
  const settings = await getAiSettings(userId);
  const own = ownRuntimeSettings(settings);
  if (own) return own;
  const starter = readStarterAiConfig();
  if (starter) {
    return {
      provider: starter.provider,
      model: starter.model,
      reasoningMode: "fast",
      apiKey: starter.apiKey,
      source: "starter",
      starterLimit: starter.credits,
    };
  }
  if (!settings.provider || !settings.model) {
    throw new Error("AI_NOT_CONFIGURED: Configure AI provider and model in Settings.");
  }
  throw new Error("AI_KEY_MISSING: Add your provider API key in Settings.");
}

function ownRuntimeSettings(settings: AiSettings): AiRuntimeSettings | null {
  if (!settings.provider || !settings.model || !settings.encryptedApiKey) return null;
  return {
    provider: settings.provider,
    model: settings.model,
    reasoningMode: settings.reasoningMode,
    apiKey: decryptSecret(settings.encryptedApiKey),
    source: "user",
    ...(settings.modelCheckedAt ? { modelCheckedAt: settings.modelCheckedAt } : {}),
  };
}

/**
 * The user's own complete AI configuration, or null. Session analysis runs
 * only on this: removing the key never falls back to the hosted key.
 */
export async function getOwnAiRuntimeSettings(userId: string): Promise<AiRuntimeSettings | null> {
  return ownRuntimeSettings(await getAiSettings(userId));
}

/**
 * Stores a provider, its model, and (when given) its key. Only the
 * verify-and-save flow (ai-connection.ts) writes a new key, so a key is never
 * stored unless the provider accepted it.
 */
export async function setAiSettings(
  userId: string,
  value: { provider: AiProvider; model: string; apiKey?: string; modelCheckedAt?: string },
) {
  const existing = await getAiSettings(userId);
  // A stored key belongs to the provider it was entered for. Never carry it
  // over to a different provider — it would be sent to the wrong API.
  const retainedKey =
    existing.provider === value.provider ? existing.encryptedApiKey : undefined;
  const next: AiSettings = {
    provider: value.provider,
    model: value.model,
    reasoningMode: "fast",
    encryptedApiKey:
      value.apiKey === undefined
        ? retainedKey
        : value.apiKey
          ? encryptSecret(value.apiKey)
          : undefined,
    ...(value.modelCheckedAt ? { modelCheckedAt: value.modelCheckedAt } : {}),
  };
  await writeAiSettings(userId, next);
}

/** Removes the stored key; the provider stays so the form opens on the key step. */
export async function removeAiKey(userId: string) {
  const existing = await getAiSettings(userId);
  await writeAiSettings(userId, { provider: existing.provider, model: existing.model, reasoningMode: "fast" });
}

/**
 * Records the worker's latest model pick. Skipped if the user changed provider
 * or removed the key meanwhile.
 */
export async function updateAiModel(userId: string, value: { provider: AiProvider; model: string; modelCheckedAt: string }) {
  const existing = await getAiSettings(userId);
  if (existing.provider !== value.provider || !existing.encryptedApiKey) return;
  await writeAiSettings(userId, { ...existing, model: value.model, modelCheckedAt: value.modelCheckedAt });
}

async function writeAiSettings(userId: string, next: AiSettings) {
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: KEY_AI, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
}

async function readReviewSettings(userId: string): Promise<ReviewSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_REVIEW)));
  const row = rows[0];
  if (!row) return DEFAULT_REVIEW_SETTINGS;
  const value = row.value as Partial<ReviewSettings>;
  const timeZoneConfigured = isValidTimeZone(value.timeZone);
  return {
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit),
    timeZone: normalizeTimeZone(value.timeZone),
    timeZoneConfigured,
    initialReviewDelayHours: clampInitialReviewDelayHours(value.initialReviewDelayHours),
  };
}

/** Memoized per request — the queue status and the analysis page both read it.
 *  Writers use readReviewSettings() so they always merge against fresh state. */
export const getReviewSettings = cache(readReviewSettings);

export async function setReviewSettings(
  userId: string,
  value: { dailyReviewLimit?: number; timeZone?: string; initialReviewDelayHours?: number },
) {
  const db = getDb();
  const existing = await readReviewSettings(userId);
  const next: { dailyReviewLimit: number; timeZone?: string; initialReviewDelayHours: number } = {
    dailyReviewLimit: clampDailyLimit(value.dailyReviewLimit ?? existing.dailyReviewLimit),
    ...(existing.timeZoneConfigured ? { timeZone: existing.timeZone } : {}),
    ...(value.timeZone !== undefined ? { timeZone: normalizeTimeZone(value.timeZone) } : {}),
    initialReviewDelayHours: clampInitialReviewDelayHours(value.initialReviewDelayHours ?? existing.initialReviewDelayHours),
  };
  await db
    .insert(schema.settings)
    .values({ userId, key: KEY_REVIEW, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
}

async function readGenerationSettings(userId: string): Promise<GenerationSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_GENERATION)));
  const row = rows[0];
  if (!row) return DEFAULT_GENERATION_SETTINGS;
  const value = row.value as Partial<GenerationSettings>;
  return { language: normalizeLanguage(value.language) };
}

export const getGenerationSettings = cache(readGenerationSettings);

export async function setGenerationSettings(
  userId: string,
  value: Partial<GenerationSettings>,
) {
  const db = getDb();
  const existing = await readGenerationSettings(userId);
  const next: GenerationSettings = {
    language:
      value.language === undefined ? existing.language : normalizeLanguage(value.language),
  };
  await db
    .insert(schema.settings)
    .values({ userId, key: KEY_GENERATION, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
}

function clampDailyLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_REVIEW_SETTINGS.dailyReviewLimit;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

export async function getAnalysisSettings(userId: string): Promise<AnalysisSettings> {
  const [row] = await getDb()
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY_ANALYSIS)));
  // A stored `dailyAutomaticLimit` from before the limit was retired is ignored.
  const value = (row?.value ?? {}) as Partial<AnalysisSettings>;
  return { automatic: typeof value.automatic === "boolean" ? value.automatic : DEFAULT_ANALYSIS_SETTINGS.automatic };
}

export async function setAnalysisSettings(userId: string, value: Partial<AnalysisSettings>) {
  const existing = await getAnalysisSettings(userId);
  const next: AnalysisSettings = { automatic: value.automatic ?? existing.automatic };
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: KEY_ANALYSIS, value: next })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: next, updatedAt: new Date() },
    });
  return next;
}

