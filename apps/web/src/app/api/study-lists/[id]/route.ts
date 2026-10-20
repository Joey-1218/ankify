import { NextResponse } from "next/server";
import { studyListPatchSchema } from "@ankileet/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { RATE_LIMITS, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { deleteStudyList, updateStudyList } from "@/server/study-lists/commands";
import { NO_STORE, readListWrite, studyListErrorResponse } from "@/server/study-lists/http";
import { loadStudyListDetail, MY_PROBLEMS_ID } from "@/server/study-lists/lists";

/** GET /api/study-lists/:id — one of the user's lists (or `my-problems`) with every entry. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const detail = await loadStudyListDetail(user.id, id === MY_PROBLEMS_ID ? { kind: "my_problems" } : { kind: "list", id });
  if (!detail) return NextResponse.json({ error: "list_not_found" }, { status: 404 });
  return NextResponse.json(detail, { headers: NO_STORE });
}

/** PATCH /api/study-lists/:id — rename (custom lists), pause or resume, reweight. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const write = await readListWrite(req, studyListPatchSchema);
  if ("response" in write) return write.response;
  const { id } = await ctx.params;
  const result = await updateStudyList(write.user.id, id, write.input);
  if (!result.ok) return studyListErrorResponse(result);
  const detail = await loadStudyListDetail(write.user.id, { kind: "list", id });
  return NextResponse.json({ list: detail!.list });
}

/** DELETE /api/study-lists/:id — delete a custom list or unfollow a built-in one; problems stay. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const limit = await checkRateLimit(user.id, "lists", RATE_LIMITS.lists);
  if (!limit.ok) return rateLimitResponse(limit.retryAfterSec);
  const { id } = await ctx.params;
  const result = await deleteStudyList(user.id, id);
  if (!result.ok) return studyListErrorResponse(result);
  return NextResponse.json({ ok: true });
}
