import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadPatternProfileDto } from "@/server/mistake-profile";

/** GET /api/mistakes/patterns — how each pattern holds up over the last 90
 *  days, its confirmed causes, and problems to practice a weak one next. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json(await loadPatternProfileDto(user.id), { headers: { "Cache-Control": "private, no-store" } });
}
