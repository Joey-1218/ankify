import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { NO_STORE } from "@/server/study-lists/http";
import { loadStudyListDetail } from "@/server/study-lists/lists";

/** GET /api/study-lists/builtin/:builtinId — a built-in list with the user's progress, followed or not. */
export async function GET(req: Request, ctx: { params: Promise<{ builtinId: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { builtinId } = await ctx.params;
  const detail = await loadStudyListDetail(user.id, { kind: "builtin", builtinId });
  if (!detail) return NextResponse.json({ error: "builtin_not_found" }, { status: 404 });
  return NextResponse.json(detail, { headers: NO_STORE });
}
