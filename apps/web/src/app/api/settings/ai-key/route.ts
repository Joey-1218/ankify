import { NextResponse } from "next/server";
import { aiKeyRequestSchema } from "@ankileet/contracts";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { verifyAndSaveAiKey } from "@/server/ai-connection";
import { removeAiKey } from "@/server/settings";

// Verifying may try up to three models, each one short provider call.
export const maxDuration = 180;

/**
 * POST /api/settings/ai-key
 *
 * Body: { provider, apiKey? }. Verifies the key against the provider and
 * saves it, with a server-picked model, only if it works. Without `apiKey`
 * the key already stored for that provider is verified again. This is the
 * only way to store a key. Session-only.
 */
export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => ({}));
  const parsed = aiKeyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await verifyAndSaveAiKey(user.id, parsed.data);
  return NextResponse.json(result, { status: !result.ok && result.code === "missing_api_key" ? 400 : 200 });
}

/** DELETE /api/settings/ai-key: removes the stored key. Session-only. */
export async function DELETE(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  await removeAiKey(user.id);
  return NextResponse.json({ ok: true });
}
