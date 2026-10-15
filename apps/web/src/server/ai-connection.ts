import { generateText, Output } from "ai";
import { z } from "zod";
import { aiProviderName } from "@/lib/ai-providers";
import { buildModel } from "./ai";
import { safeErrorForLog } from "./ai-errors";
import { resolveAnalysisModels, type ModelProvider } from "./ai-model-choice";
import { markAiVerified } from "./onboarding";
import { decryptSecret } from "./secret-box";
import { getAiSettings, setAiSettings } from "./settings";

const probeSchema = z.object({ ok: z.literal(true) });
const VERIFY_TIMEOUT_MS = 175_000;

type VerifyAiKeyInput = {
  provider: ModelProvider;
  /** Omitted to verify the key already stored for this provider again. */
  apiKey?: string;
};

export type VerifyAiKeyResult =
  | { ok: true; provider: ModelProvider; model: string; latencyMs: number }
  | {
      ok: false;
      code: string;
      message: string;
      provider: ModelProvider;
      /** For `key_provider_mismatch`: the provider the key appears to belong to. */
      detectedProvider?: ModelProvider;
    };

/**
 * Checks a key against its provider and stores it only if it works: the
 * provider's model list is read with the key, the fast-tier models are tried
 * in order with one structured-output call (the shape session analysis
 * uses), and the first that answers is saved with the key. Nothing is stored
 * on failure, so a key entered under the wrong provider never looks
 * configured.
 */
export async function verifyAndSaveAiKey(userId: string, input: VerifyAiKeyInput): Promise<VerifyAiKeyResult> {
  const { provider } = input;
  const stored = await getAiSettings(userId);
  const apiKey =
    input.apiKey ??
    (provider === stored.provider && stored.encryptedApiKey ? safeDecrypt(stored.encryptedApiKey) : undefined);
  if (!apiKey) {
    return { ok: false, code: "missing_api_key", message: "Add an API key for this provider.", provider };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const resolved = await resolveAnalysisModels(provider, apiKey, controller.signal);
    if (!resolved.ok) return keyRejected(provider, apiKey);

    let failure: { code: string; message: string } | null = null;
    for (const model of resolved.candidates) {
      try {
        await generateText({
          model: buildModel({ provider, model, apiKey }, { disableThinking: true }),
          output: Output.object({ schema: probeSchema }),
          system: "You are a connection probe. Respond with {\"ok\": true}.",
          prompt: 'Respond with the JSON object {"ok": true} and nothing else.',
          temperature: 0,
          maxRetries: 0,
          abortSignal: controller.signal,
        });
      } catch (error) {
        console.warn("[ai-key] provider probe failed", safeErrorForLog(error));
        failure = classifyAiError(error);
        if (failure.code === "invalid_api_key") return keyRejected(provider, apiKey);
        // This model is unavailable to the key, or busy; the next one may not be.
        if (failure.code === "model_not_found" || failure.code === "forbidden" || failure.code === "provider_unavailable") continue;
        return { ok: false, ...failure, provider };
      }

      await setAiSettings(userId, { provider, model, apiKey, modelCheckedAt: new Date().toISOString() });
      await markAiVerified(userId);
      return { ok: true, provider, model, latencyMs: Date.now() - startedAt };
    }
    if (failure?.code === "provider_unavailable") return { ok: false, ...failure, provider };
    return {
      ok: false,
      code: "no_usable_model",
      message: `${aiProviderName(provider)} accepted the key but none of its fast models answered. Check the key's model access.`,
      provider,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The provider a key's prefix names, when the prefix is unambiguous. Plain
 * `sk-` keys are left alone except DeepSeek's `sk-` + 32 lowercase hex, which
 * no OpenAI key format uses.
 */
export function detectKeyProvider(apiKey: string): ModelProvider | null {
  const key = apiKey.trim();
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("AIza")) return "google";
  if (/^sk-(proj|svcacct|admin)-/.test(key)) return "openai";
  if (/^sk-[0-9a-f]{32}$/.test(key)) return "deepseek";
  return null;
}

function keyRejected(provider: ModelProvider, apiKey: string): VerifyAiKeyResult {
  const detected = detectKeyProvider(apiKey);
  if (detected && detected !== provider) {
    return {
      ok: false,
      code: "key_provider_mismatch",
      message: `${aiProviderName(provider)} rejected this key. It looks like a ${aiProviderName(detected)} key.`,
      provider,
      detectedProvider: detected,
    };
  }
  return {
    ok: false,
    code: "invalid_api_key",
    message: `${aiProviderName(provider)} rejected this key. Check that it is a ${aiProviderName(provider)} key, or choose another provider.`,
    provider,
  };
}

function safeDecrypt(
  envelope: NonNullable<Awaited<ReturnType<typeof getAiSettings>>["encryptedApiKey"]>,
) {
  try {
    return decryptSecret(envelope);
  } catch {
    return undefined;
  }
}

export function classifyAiError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (status === 401) return { code: "invalid_api_key", message: "API key was rejected by the provider." };
  if (status === 403) return { code: "forbidden", message: "API key does not have access to this model." };
  if (status === 404) return { code: "model_not_found", message: "Model id was not recognized by the provider." };
  if (status === 429) return { code: "quota_or_rate_limit", message: "Provider returned a rate limit or quota error." };
  if (typeof status === "number" && status >= 500) {
    return { code: "provider_unavailable", message: "The provider is busy or unavailable right now. Try again in a minute." };
  }

  if (lower.includes("aborted") || lower.includes("timeout")) {
    return { code: "timeout", message: "Provider did not respond within 3 minutes." };
  }
  if (
    lower.includes("401") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("api key not valid") ||
    lower.includes("authentication")
  ) {
    return { code: "invalid_api_key", message: "API key was rejected by the provider." };
  }
  if (lower.includes("403") || lower.includes("forbidden") || lower.includes("permission")) {
    return { code: "forbidden", message: "API key does not have access to this model." };
  }
  if (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("model_not_found") ||
    lower.includes("model not exist") ||
    lower.includes("does not exist")
  ) {
    return { code: "model_not_found", message: "Model id was not recognized by the provider." };
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("insufficient")
  ) {
    return { code: "quota_or_rate_limit", message: "Provider returned a rate limit or quota error." };
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused")
  ) {
    return { code: "network", message: "Could not reach the provider." };
  }
  return {
    code: "unknown",
    message: "The provider rejected the test or returned an unexpected response.",
  };
}
