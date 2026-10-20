import type { LocalizedTextDto } from "@ankileet/contracts";
import type { Language } from "@/lib/i18n";

export type SendResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A JSON request to the list API; the error is the server's code, or `HTTP <status>`. */
export async function sendJson<T = unknown>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<SendResult<T>> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: "network" };
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  return response.ok ? { ok: true, data: data as T } : { ok: false, error: data?.error ?? `HTTP ${response.status}` };
}

export const pick = (text: LocalizedTextDto, language: Language) => (language === "zh" ? text.zh : text.en);
