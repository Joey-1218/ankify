import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { isWorkflowEnabled, workflowDisabledResponse } from "@/server/features";
import { deletePracticeSession } from "@/server/practice-sessions/delete";
import { requestOwnerToken, sessionErrorResponse } from "@/server/practice-sessions/http";
import { getPracticeSessionDetail } from "@/server/practice-sessions/queries";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";

/** GET /api/practice-sessions/:id — the session, its problem, and observations. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const { id } = await ctx.params;
  const detail = await getPracticeSessionDetail(user.id, id, requestOwnerToken(req));
  if (!detail) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
}

/** DELETE /api/practice-sessions/:id — deletes a finished session and undoes
 *  its scheduling (409 `undo_conflict` when a later change is in effect). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  if (!isWorkflowEnabled("practice_sessions")) return workflowDisabledResponse();

  const limit = await checkRateLimit(user.id, "sessions", RATE_LIMITS.sessions);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);

  const { id } = await ctx.params;
  const result = await deletePracticeSession(user.id, id);
  if (!result.ok) return sessionErrorResponse(result);
  return NextResponse.json(result.response);
}
