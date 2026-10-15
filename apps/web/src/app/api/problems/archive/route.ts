import { NextResponse } from "next/server";
import { problemsArchiveSchema, type ProblemsArchiveResponseDto } from "@ankileet/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { setProblemsArchived } from "@/server/problem-archive";

/** POST /api/problems/archive — archive or unarchive problems selected in the
 *  problems list. Reversible, like the single-problem PATCH. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = problemsArchiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await setProblemsArchived(user.id, parsed.data.problemIds, parsed.data.archived);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: 409 });
  }
  return NextResponse.json({ ok: true, updated: result.updated, dueCount: result.dueCount } satisfies ProblemsArchiveResponseDto);
}
