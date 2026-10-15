import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_ANALYSIS_MODEL, listModels, rankAnalysisModels, resolveAnalysisModels } from "./ai-model-choice";

vi.mock("./settings", () => ({ updateAiModel: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

const ids = (...list: string[]) => list.map((id) => ({ id }));

describe("analysis model ranking", () => {
  it("picks the newest Claude Haiku, never Sonnet or Opus", () => {
    expect(
      rankAnalysisModels("anthropic", [
        { id: "claude-opus-5-5", createdAt: 300 },
        { id: "claude-sonnet-5-5", createdAt: 300 },
        { id: "claude-3-5-haiku-20241022", createdAt: 100 },
        { id: "claude-haiku-4-5-20251001", createdAt: 200 },
        { id: "claude-haiku-5-5", createdAt: 300 },
      ]),
    ).toEqual(["claude-haiku-5-5", "claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022"]);
  });

  it("picks the newest GPT mini alias over its snapshots, nano, and full models", () => {
    expect(
      rankAnalysisModels(
        "openai",
        ids("gpt-5.5", "gpt-5.4-nano", "gpt-5.4-mini-2026-03-17", "gpt-4o-mini", "gpt-5.4-mini", "gpt-5-mini", "o4-mini", "gpt-5.4-mini-audio"),
      ),
    ).toEqual(["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17", "gpt-5-mini", "gpt-4o-mini"]);
  });

  it("picks the newest stable Gemini Flash, over Lite and previews", () => {
    expect(
      rankAnalysisModels(
        "google",
        ids("gemini-3.8-flash-lite", "gemini-3.9-flash-preview-09-2026", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.5-pro", "gemini-3.8-flash-image"),
      ),
    ).toEqual(["gemini-3.8-flash", "gemini-3.5-flash"]);
    expect(rankAnalysisModels("google", ids("gemini-4-flash-preview", "gemini-4-pro"))).toEqual(["gemini-4-flash-preview"]);
  });

  it("picks DeepSeek's newest Flash, then the legacy chat model", () => {
    expect(rankAnalysisModels("deepseek", ids("deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v5-flash", "deepseek-chat", "deepseek-reasoner"))).toEqual([
      "deepseek-v5-flash",
      "deepseek-v4-flash",
      "deepseek-chat",
    ]);
  });

  it("returns nothing when no listed model belongs to the fast tier", () => {
    expect(rankAnalysisModels("openai", ids("gpt-5.5", "gpt-image-2"))).toEqual([]);
  });
});

describe("resolveAnalysisModels", () => {
  it("offers at most three ranked models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: ids("gpt-5.4-mini", "gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-5.5") })));
    expect(await resolveAnalysisModels("openai", "sk-x")).toEqual({ ok: true, candidates: ["gpt-5.4-mini", "gpt-5-mini", "gpt-4.1-mini"] });
  });

  it("falls back when nothing matches or the list can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: ids("deepseek-reasoner") })));
    expect(await resolveAnalysisModels("deepseek", "sk-x")).toEqual({ ok: true, candidates: [FALLBACK_ANALYSIS_MODEL.deepseek] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await resolveAnalysisModels("deepseek", "sk-x")).toEqual({ ok: true, candidates: [FALLBACK_ANALYSIS_MODEL.deepseek] });
  });

  it("fails when the provider rejects the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    expect(await resolveAnalysisModels("openai", "sk-deepseek")).toMatchObject({ ok: false, code: "invalid_api_key" });
  });
});

describe("Gemini model list", () => {
  it("lists only Gemini models that generate content, across pages", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gk");
      if (!url.searchParams.get("pageToken")) {
        return Response.json({
          models: [
            { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
            { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
          ],
          nextPageToken: "p2",
        });
      }
      return Response.json({
        models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await listModels("google", "gk", new AbortController().signal)).toEqual([
      { id: "gemini-3.8-flash", label: undefined },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports Gemini's 400 for a bad key as a rejected key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 })));
    expect(await resolveAnalysisModels("google", "bad")).toMatchObject({ ok: false, code: "invalid_api_key" });
  });
});
