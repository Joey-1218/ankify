import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { getDb, schema } from "@ankileet/db";
import { and, eq } from "drizzle-orm";
import { buildModel } from "./ai";
import { detectKeyProvider, verifyAndSaveAiKey } from "./ai-connection";
import { getOnboardingProgress } from "./onboarding";
import { getAiSettings, getOwnAiRuntimeSettings, setAiSettings } from "./settings";
import { createTestDb } from "./test-db";

// The provider's model list (fetch) and its model calls (buildModel) are the
// only mocks; every assertion reads the real database.
vi.mock("./ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("./ai")>()), buildModel: vi.fn() }));

process.env.AI_KEY_ENCRYPTION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const testDb = createTestDb();
const USER = "ai-key-owner";
const DEEPSEEK_KEY = `sk-${"a1".repeat(16)}`;

const ok = {
  content: [{ type: "text" as const, text: '{"ok":true}' }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

const providerError = (statusCode: number, message: string) =>
  new APICallError({ message, url: "https://provider.test/v1/chat/completions", requestBodyValues: {}, statusCode, isRetryable: false });

/** Each model id answers with its entry: an error, or the probe's {"ok":true}. */
function useModels(answers: Record<string, Error | "ok">) {
  vi.mocked(buildModel).mockImplementation((settings) =>
    new MockLanguageModelV4({
      modelId: settings.model,
      doGenerate: async () => {
        const answer = answers[settings.model];
        if (!answer) throw providerError(404, "model not found");
        if (answer instanceof Error) throw answer;
        return ok;
      },
    }),
  );
}

function listing(models: string[] | number) {
  const fetchMock = vi.fn(async () =>
    typeof models === "number" ? new Response("{}", { status: models }) : Response.json({ data: models.map((id) => ({ id })) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values({ id: USER, name: "Owner", email: "ai-key@example.test" });
  vi.mocked(buildModel).mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => testDb.cleanup());

describe("verifyAndSaveAiKey", () => {
  it("saves a working key with the provider's fast model and marks AI verified", async () => {
    listing(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat"]);
    useModels({ "deepseek-v4-flash": "ok" });

    const result = await verifyAndSaveAiKey(USER, { provider: "deepseek", apiKey: DEEPSEEK_KEY });
    expect(result).toMatchObject({ ok: true, provider: "deepseek", model: "deepseek-v4-flash" });
    expect(await getOwnAiRuntimeSettings(USER)).toMatchObject({ provider: "deepseek", model: "deepseek-v4-flash", apiKey: DEEPSEEK_KEY, reasoningMode: "fast" });
    expect((await getAiSettings(USER)).modelCheckedAt).toBeTruthy();
    expect((await getOnboardingProgress(USER)).aiChoice).toBe("configured");
  });

  it("stores nothing when the chosen provider rejects the key (the reported bug)", async () => {
    // A DeepSeek key entered while OpenAI is selected: OpenAI answers 401.
    listing(401);
    const result = await verifyAndSaveAiKey(USER, { provider: "openai", apiKey: DEEPSEEK_KEY });
    expect(result).toMatchObject({ ok: false, code: "key_provider_mismatch", provider: "openai", detectedProvider: "deepseek" });
    expect(buildModel).not.toHaveBeenCalled();
    expect(await getDb().select().from(schema.settings).where(and(eq(schema.settings.userId, USER), eq(schema.settings.key, "ai")))).toEqual([]);
    expect((await getOnboardingProgress(USER)).aiChoice).toBe("not_started");
  });

  it("names the provider when a rejected key's format is ambiguous", async () => {
    listing(401);
    const result = await verifyAndSaveAiKey(USER, { provider: "deepseek", apiKey: "sk-Legacy0penAiStyleKeyWithMixedCase0123456789abcdefgh" });
    expect(result).toMatchObject({ ok: false, code: "invalid_api_key", message: expect.stringContaining("DeepSeek rejected this key") });
  });

  it("treats a rejection on the probe like a rejection on the list", async () => {
    listing(503);
    useModels({ [`gpt-5.4-mini`]: providerError(401, "Incorrect API key provided") });
    const result = await verifyAndSaveAiKey(USER, { provider: "openai", apiKey: "sk-ant-api03-x" });
    expect(result).toMatchObject({ ok: false, code: "key_provider_mismatch", detectedProvider: "anthropic" });
    expect(await getOwnAiRuntimeSettings(USER)).toBeNull();
  });

  it("moves to the next model when one isn't available to the key", async () => {
    listing(["gpt-5.6-mini", "gpt-5.4-mini"]);
    useModels({ "gpt-5.6-mini": providerError(404, "The model `gpt-5.6-mini` does not exist"), "gpt-5.4-mini": "ok" });
    const result = await verifyAndSaveAiKey(USER, { provider: "openai", apiKey: "sk-proj-x" });
    expect(result).toMatchObject({ ok: true, model: "gpt-5.4-mini" });
    expect((await getAiSettings(USER)).model).toBe("gpt-5.4-mini");
  });

  it("tries the next model when one is busy, and says so when all are", async () => {
    listing(["gemini-3.8-flash", "gemini-3.5-flash"]);
    useModels({ "gemini-3.8-flash": providerError(503, "high demand"), "gemini-3.5-flash": "ok" });
    expect(await verifyAndSaveAiKey(USER, { provider: "google", apiKey: "AIzaX" })).toMatchObject({ ok: true, model: "gemini-3.5-flash" });

    useModels({ "gemini-3.8-flash": providerError(503, "high demand"), "gemini-3.5-flash": providerError(503, "high demand") });
    expect(await verifyAndSaveAiKey(USER, { provider: "google", apiKey: "AIzaY" })).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect((await getOwnAiRuntimeSettings(USER))?.apiKey).toBe("AIzaX");
  });

  it("reports no usable model when every candidate is refused", async () => {
    listing(["gpt-5.4-mini"]);
    useModels({ "gpt-5.4-mini": providerError(403, "forbidden") });
    expect(await verifyAndSaveAiKey(USER, { provider: "openai", apiKey: "sk-proj-x" })).toMatchObject({ ok: false, code: "no_usable_model" });
    expect(await getOwnAiRuntimeSettings(USER)).toBeNull();
  });

  it("verifies the stored key again, but never a key stored for another provider", async () => {
    await setAiSettings(USER, { provider: "deepseek", model: "deepseek-v4-flash", apiKey: DEEPSEEK_KEY });
    expect(await verifyAndSaveAiKey(USER, { provider: "openai" })).toMatchObject({ ok: false, code: "missing_api_key" });

    listing(["deepseek-v4-flash"]);
    useModels({ "deepseek-v4-flash": "ok" });
    expect(await verifyAndSaveAiKey(USER, { provider: "deepseek" })).toMatchObject({ ok: true, model: "deepseek-v4-flash" });
    expect(vi.mocked(buildModel).mock.calls[0]![0]).toMatchObject({ apiKey: DEEPSEEK_KEY });
  });

  it("keeps the previous working key when a new one fails", async () => {
    await setAiSettings(USER, { provider: "deepseek", model: "deepseek-v4-flash", apiKey: DEEPSEEK_KEY });
    listing(401);
    await verifyAndSaveAiKey(USER, { provider: "deepseek", apiKey: `sk-${"b2".repeat(16)}` });
    expect((await getOwnAiRuntimeSettings(USER))?.apiKey).toBe(DEEPSEEK_KEY);
  });
});

describe("detectKeyProvider", () => {
  it("recognizes only unambiguous key formats", () => {
    expect(detectKeyProvider("sk-ant-api03-abc")).toBe("anthropic");
    expect(detectKeyProvider("AIzaSyExample")).toBe("google");
    expect(detectKeyProvider("sk-proj-abc")).toBe("openai");
    expect(detectKeyProvider(DEEPSEEK_KEY)).toBe("deepseek");
    expect(detectKeyProvider("sk-abcDEF123")).toBeNull();
  });
});
