import { NextResponse } from "next/server";
import { studyListBatchAddSchema, studyListItemAddSchema, studyListOrderSchema } from "@ankileet/contracts";
import { z } from "zod";
import { addProblemsToStudyList, addStudyListItem, reorderStudyListItems } from "@/server/study-lists/commands";
import { readListWrite, studyListErrorResponse } from "@/server/study-lists/http";

const addSchema = z.union([studyListItemAddSchema, studyListBatchAddSchema]);

/**
 * POST /api/study-lists/:id/items — add a problem to the end of a custom
 * list, or several of the deck's problems at once (`source: "problems"`).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const write = await readListWrite(req, addSchema, 160_000);
  if (!write.ok) return write.response;
  const { id } = await ctx.params;
  if (write.input.source === "problems") {
    const batch = await addProblemsToStudyList(write.user.id, id, write.input.problemIds);
    if (!batch.ok) return studyListErrorResponse(batch);
    return NextResponse.json({ added: batch.added, existing: batch.existing });
  }
  const result = await addStudyListItem(write.user.id, id, write.input);
  if (!result.ok) return studyListErrorResponse(result);
  return NextResponse.json({ itemId: result.itemId, created: result.created }, { status: result.created ? 201 : 200 });
}

/** PUT /api/study-lists/:id/items — reorder a custom list (every item id, once). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const write = await readListWrite(req, studyListOrderSchema, 160_000);
  if (!write.ok) return write.response;
  const { id } = await ctx.params;
  const result = await reorderStudyListItems(write.user.id, id, write.input.itemIds);
  if (!result.ok) return studyListErrorResponse(result);
  return NextResponse.json({ ok: true });
}
