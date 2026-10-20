import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { removeStudyListItem } from "@/server/study-lists/commands";
import { studyListErrorResponse } from "@/server/study-lists/http";

/** DELETE /api/study-lists/:id/items/:itemId — remove a problem from a custom list; the problem stays in the deck. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const limit = await checkRateLimit(user.id, "lists", RATE_LIMITS.lists);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);
  const { id, itemId } = await ctx.params;
  const result = await removeStudyListItem(user.id, id, itemId);
  if (!result.ok) return studyListErrorResponse(result);
  return NextResponse.json({ ok: true });
}
