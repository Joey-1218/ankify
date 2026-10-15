import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAiSettings,
  getAnalysisSettings,
  getGenerationSettings,
  getReviewSettings,
  setAnalysisSettings,
  setGenerationSettings,
  setReviewSettings,
} from "@/server/settings";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { isValidTimeZone } from "@/server/time-zone";

const settingsSchema = z
  .object({
    dailyReviewLimit: z.number().int().min(1).max(100).optional(),
    initialReviewDelayHours: z.number().int().min(1).max(168).optional(),
    timeZone: z.string().max(128).refine(isValidTimeZone, "Invalid IANA time zone.").optional(),
    generationLanguage: z.enum(["en", "zh"]).optional(),
    analysisAutomatic: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.dailyReviewLimit != null ||
      value.initialReviewDelayHours != null ||
      value.timeZone != null ||
      value.generationLanguage != null ||
      value.analysisAutomatic != null,
    {
      // AI keys are saved only after verification: POST /api/settings/ai-key.
      message: "Provide review, generation, or analysis settings.",
    },
  );

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const [ai, review, generation, analysis] = await Promise.all([
    getAiSettings(user.id),
    getReviewSettings(user.id),
    getGenerationSettings(user.id),
    getAnalysisSettings(user.id),
  ]);
  // Don't leak the key back to the client; just whether one is set
  return NextResponse.json({
    ai: {
      provider: ai.provider,
      model: ai.model,
      hasApiKey: Boolean(ai.encryptedApiKey),
    },
    review,
    generation,
    analysis,
  });
}

export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.dailyReviewLimit != null || parsed.data.timeZone != null || parsed.data.initialReviewDelayHours != null) {
    await setReviewSettings(user.id, {
      dailyReviewLimit: parsed.data.dailyReviewLimit,
      timeZone: parsed.data.timeZone,
      initialReviewDelayHours: parsed.data.initialReviewDelayHours,
    });
  }
  if (parsed.data.generationLanguage != null) {
    await setGenerationSettings(user.id, { language: parsed.data.generationLanguage });
  }
  if (parsed.data.analysisAutomatic != null) {
    await setAnalysisSettings(user.id, { automatic: parsed.data.analysisAutomatic });
  }
  return NextResponse.json({ ok: true });
}
