import { NextResponse } from "next/server";
import { studyListItemAddSchema, studyListOrderSchema } from "@ankileet/contracts";
import { addStudyListItem, reorderStudyListItems } from "@/server/study-lists/commands";
import { readListWrite, studyListErrorResponse } from "@/server/study-lists/http";

/** POST /api/study-lists/:id/items — add a problem to the end of a custom list. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const write = await readListWrite(req, studyListItemAddSchema);
  if ("response" in write) return write.response;
  const { id } = await ctx.params;
  const result = await addStudyListItem(write.user.id, id, write.input);
  if (!result.ok) return studyListErrorResponse(result);
  return NextResponse.json({ itemId: result.itemId, created: result.created }, { status: result.created ? 201 : 200 });
}

/** PUT /api/study-lists/:id/items — reorder a custom list (every item id, once). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const write = await readListWrite(req, studyListOrderSchema, 160_000);
  if ("response" in write) return write.response;
  const { id } = await ctx.params;
  const result = await reorderStudyListItems(write.user.id, id, write.input.itemIds);
  if (!result.ok) return studyListErrorResponse(result);
  return NextResponse.json({ ok: true });
}
