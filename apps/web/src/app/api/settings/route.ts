import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAiSettings,
  getAnalysisSettings,
  getGenerationSettings,
  getReviewSettings,
  getStudyPlanSettings,
  setAnalysisSettings,
  setGenerationSettings,
  setReviewSettings,
  setStudyPlanSettings,
} from "@/server/settings";
import { STUDY_PLAN_LIMITS } from "@ankileet/core";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { isValidTimeZone } from "@/server/time-zone";

const settingsSchema = z
  .object({
    dailyReviewLimit: z.number().int().min(1).max(100).optional(),
    initialReviewDelayHours: z.number().int().min(1).max(168).optional(),
    timeZone: z.string().max(128).refine(isValidTimeZone, "Invalid IANA time zone.").optional(),
    generationLanguage: z.enum(["en", "zh"]).optional(),
    analysisAutomatic: z.boolean().optional(),
    studyPlan: z
      .object({
        dailyMinutes: z.number().int().min(STUDY_PLAN_LIMITS.dailyMinutes.min).max(STUDY_PLAN_LIMITS.dailyMinutes.max).optional(),
        maxNewPerDay: z.number().int().min(STUDY_PLAN_LIMITS.maxNewPerDay.min).max(STUDY_PLAN_LIMITS.maxNewPerDay.max).optional(),
        hidePatternsOnToday: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (value) =>
      value.dailyReviewLimit != null ||
      value.initialReviewDelayHours != null ||
      value.timeZone != null ||
      value.generationLanguage != null ||
      value.analysisAutomatic != null ||
      value.studyPlan != null,
    {
      // AI keys are saved only after verification: POST /api/settings/ai-key.
      message: "Provide review, generation, analysis, or study plan settings.",
    },
  );

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const [ai, review, generation, analysis, studyPlan] = await Promise.all([
    getAiSettings(user.id),
    getReviewSettings(user.id),
    getGenerationSettings(user.id),
    getAnalysisSettings(user.id),
    getStudyPlanSettings(user.id),
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
    studyPlan,
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
  if (parsed.data.studyPlan != null) {
    await setStudyPlanSettings(user.id, parsed.data.studyPlan);
  }
  return NextResponse.json({ ok: true });
}
