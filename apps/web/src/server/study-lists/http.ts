import { NextResponse } from "next/server";
import type { z } from "zod";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { readJsonBody } from "@/server/request-body";
import type { StudyListFailure } from "./commands";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function studyListErrorResponse(failure: StudyListFailure) {
  const status =
    failure.error === "list_not_found" ||
    failure.error === "builtin_not_found" ||
    failure.error === "problem_not_found" ||
    failure.error === "problem_not_listed"
      ? 404
      : failure.error === "list_limit_reached" || failure.error === "item_limit_reached"
        ? 403
        : 409;
  return NextResponse.json({ error: failure.error, ...(failure.message ? { message: failure.message } : {}) }, { status });
}

/**
 * The signed-in user and a validated body for a list write, or the response
 * that ends the request (401, 429, 400, 413).
 */
export async function readListWrite<T>(req: Request, schema: z.ZodType<T>, maxBytes = 4_096) {
  const user = await getRequestUser(req);
  if (!user) return { ok: false, response: unauthorizedResponse() } as const;
  const limit = await checkRateLimit(user.id, "lists", RATE_LIMITS.lists);
  if (!limit.ok) return { ok: false, response: rateLimitResponse(limit.retryAfterSec) } as const;
  const body = await readJsonBody(req, maxBytes);
  if (!body.ok) {
    return { ok: false, response: NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 }) } as const;
  }
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return { ok: false, response: NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 }) } as const;
  return { ok: true, user, input: parsed.data } as const;
}
