import { describe, expect, it, vi } from "vitest";
import { aiProviderEnum } from "@ankileet/contracts";
import { buildModel, GEMINI_THINKING_HEADROOM_TOKENS, providerCallOptions } from "./ai";

vi.mock("@/server/settings", () => ({
  getAiRuntimeSettings: vi.fn(),
}));

describe("Google Gemini provider", () => {
  it("is an accepted provider and builds a native Gemini model", () => {
    expect(aiProviderEnum.parse("google")).toBe("google");
    const model = buildModel({ provider: "google", model: "gemini-3.5-flash", apiKey: "k", reasoningMode: "auto" } as never);
    expect(typeof model === "object" && model.provider).toMatch(/^google/);
    expect(typeof model === "object" && model.modelId).toBe("gemini-3.5-flash");
  });

  it("keeps Gemini thinking low and leaves room for it in the output cap", () => {
    expect(providerCallOptions({ provider: "google", model: "gemini-3.8-flash" }, 2_000)).toEqual({
      maxOutputTokens: 2_000 + GEMINI_THINKING_HEADROOM_TOKENS,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    });
    expect(providerCallOptions({ provider: "google", model: "gemini-2.5-pro" }, 2_000)).toMatchObject({
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 1_024 } } },
    });
    expect(providerCallOptions({ provider: "google", model: "gemini-flash-latest" }, 2_000)).toEqual({
      maxOutputTokens: 2_000 + GEMINI_THINKING_HEADROOM_TOKENS,
    });
    expect(providerCallOptions({ provider: "deepseek", model: "deepseek-v4-flash" }, 2_000)).toEqual({ maxOutputTokens: 2_000 });
  });
});
