"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProblemStudyListsDto } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { pick, sendJson } from "../../lists/api";

/** The lists a problem is in, and adding it to one of the user's custom lists. */
export function ProblemLists({ problemId, lists }: { problemId: string; lists: ProblemStudyListsDto }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const choices = lists.customLists.filter((list) => !list.contains);
  const [chosen, setTarget] = useState(choices[0]?.id ?? "");
  // A list the problem just joined drops out of the choices.
  const target = choices.some((list) => list.id === chosen) ? chosen : (choices[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "muted" | "danger"; text: string } | null>(null);

  async function add() {
    setBusy(true);
    setMessage(null);
    const result = await sendJson<{ created: boolean }>("POST", `/api/study-lists/${target}/items`, { source: "problem", problemId });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "danger", text: t.lists.errors[result.error] ?? t.lists.failed });
    setMessage({ tone: "muted", text: result.data.created ? t.lists.added : t.lists.alreadyInList });
    router.refresh();
  }

  const href = (entry: ProblemStudyListsDto["memberOf"][number]) =>
    (entry.kind === "my_problems" ? "/lists/my-problems" : entry.kind === "builtin" ? `/lists/builtin/${entry.builtinId}` : `/lists/${entry.id}`) as Route;

  return (
    <Surface className="overflow-hidden">
      <div className="border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted">{t.lists.panelTitle}</div>
      <div className="space-y-3 px-4 py-3 text-sm">
        <p className="flex flex-wrap gap-x-2 gap-y-1">
          <span className="text-muted">{t.lists.memberOf}</span>
          {lists.memberOf.map((entry, index) => (
            <span key={entry.id ?? entry.kind}>
              <Link href={href(entry)} className="font-medium hover:underline">
                {entry.kind === "my_problems" ? t.lists.myProblems : pick(entry.name, language)}
              </Link>
              {index < lists.memberOf.length - 1 && <span className="text-muted">,</span>}
            </span>
          ))}
        </p>
        {choices.length > 0 ? (
          <div className="flex items-center gap-2">
            <Select value={target} onValueChange={setTarget} aria-label={t.lists.addTo} className="min-w-0 flex-1">
              {choices.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={busy || !target} onClick={() => void add()}>
              {busy && <Spinner />}
              {t.lists.add}
            </Button>
          </div>
        ) : (
          lists.customLists.length === 0 && <p className="text-xs text-muted">{t.lists.noCustomLists}</p>
        )}
        {message && (
          <p role="status" className={message.tone === "danger" ? "text-xs text-danger" : "text-xs text-muted"}>
            {message.text}
          </p>
        )}
      </div>
    </Surface>
  );
}
