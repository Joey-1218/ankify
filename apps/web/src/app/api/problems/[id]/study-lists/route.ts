import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { NO_STORE } from "@/server/study-lists/http";
import { loadProblemStudyLists } from "@/server/study-lists/lists";

/** GET /api/problems/:id/study-lists — the lists a problem is in, and the custom lists it could join. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const lists = await loadProblemStudyLists(user.id, id);
  if (!lists) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
  return NextResponse.json(lists, { headers: NO_STORE });
}
