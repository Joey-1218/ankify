import { NextResponse } from "next/server";
import { studyListCreateSchema, studyListsOrderSchema } from "@ankileet/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { createStudyList, reorderStudyLists } from "@/server/study-lists/commands";
import { NO_STORE, readListWrite, studyListErrorResponse } from "@/server/study-lists/http";
import { loadStudyListDetail, loadStudyListsOverview } from "@/server/study-lists/lists";

/** GET /api/study-lists — My problems, the user's lists, and the built-in lists by author. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json(await loadStudyListsOverview(user.id), { headers: NO_STORE });
}

/** POST /api/study-lists — create a custom list, follow a built-in one, or copy one. Idempotent per `requestId`. */
export async function POST(req: Request) {
  const write = await readListWrite(req, studyListCreateSchema);
  if (!write.ok) return write.response;
  const result = await createStudyList(write.user.id, write.input);
  if (!result.ok) return studyListErrorResponse(result);
  const detail = await loadStudyListDetail(write.user.id, { kind: "list", id: result.listId });
  return NextResponse.json({ list: detail!.list, created: result.created }, { status: result.created ? 201 : 200 });
}

/** PUT /api/study-lists — the order of the user's lists; My problems stays first. */
export async function PUT(req: Request) {
  const write = await readListWrite(req, studyListsOrderSchema);
  if (!write.ok) return write.response;
  const result = await reorderStudyLists(write.user.id, write.input.listIds);
  if (!result.ok) return studyListErrorResponse(result);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
