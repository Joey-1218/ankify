"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { STUDY_LIST_NAME_MAX, type ProblemStudyListsDto, type StudyListSummaryDto } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { sendJson } from "./api";

export type AddToListTarget = { kind: "problem"; problemId: string; title: string } | { kind: "problems"; problemIds: readonly string[] };

/**
 * A custom list as the picker shows it. For one problem: whether the list
 * holds it (flipped at once, put back if the request fails) and its item;
 * for several, what the last add did.
 */
type Row = { id: string; name: string; checked: boolean; itemId: string | null; result?: { added: number; existing: number } };

/**
 * "Add to list", like adding a track to playlists. For one problem every
 * custom list is a checkbox: checking adds the problem, unchecking removes
 * it. For several problems each list has an Add button (nothing is removed).
 * A new list can be made here, and the problems go straight into it. The
 * page refreshes on close when anything changed.
 */
export function AddToListDialog({
  open,
  onClose,
  target,
  lists,
}: {
  open: boolean;
  onClose: () => void;
  target: AddToListTarget;
  /** For one problem: its memberships, else they load on open. For several: the user's custom lists. */
  lists?: ProblemStudyListsDto["customLists"] | readonly { id: string; name: string }[];
}) {
  if (!open) return null;
  return <Picker onClose={onClose} target={target} lists={lists} />;
}

const rowsOf = (lists: NonNullable<Parameters<typeof AddToListDialog>[0]["lists"]>): Row[] =>
  lists.map((list) => {
    const itemId = "itemId" in list ? list.itemId : null;
    return { id: list.id, name: list.name, checked: itemId != null, itemId };
  });

function Picker({ onClose, target, lists }: Omit<Parameters<typeof AddToListDialog>[0], "open">) {
  const { t } = useLanguage();
  const l = t.lists;
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(lists ? rowsOf(lists) : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const changed = useRef(false);
  const single = target.kind === "problem";

  // One problem's memberships, when the page did not have them.
  useEffect(() => {
    if (rows || target.kind !== "problem") return;
    let live = true;
    void fetch(`/api/problems/${target.problemId}/study-lists`)
      .then((response) => (response.ok ? (response.json() as Promise<ProblemStudyListsDto>) : Promise.reject(new Error())))
      .then((data) => live && setRows(rowsOf(data.customLists)))
      .catch(() => {
        if (!live) return;
        setRows([]);
        setError(l.failed);
      });
    return () => {
      live = false;
    };
  }, [rows, target, l.failed]);

  // Closing waits for a change in flight, so the page refreshes with it.
  const close = () => {
    if (busy) return;
    if (changed.current) router.refresh();
    onClose();
  };

  const update = (id: string, patch: Partial<Row>) => setRows((current) => current?.map((row) => (row.id === id ? { ...row, ...patch } : row)) ?? null);
  const failed = (code: string) => setError(l.errors[code] ?? l.failed);

  async function add(row: Row) {
    if (target.kind === "problem") {
      update(row.id, { checked: true });
      const result = await sendJson<{ itemId: string }>("POST", `/api/study-lists/${row.id}/items`, { source: "problem", problemId: target.problemId });
      if (!result.ok) {
        update(row.id, { checked: false });
        return failed(result.error);
      }
      update(row.id, { itemId: result.data.itemId });
    } else {
      const result = await sendJson<{ added: number; existing: number }>("POST", `/api/study-lists/${row.id}/items`, { source: "problems", problemIds: target.problemIds });
      if (!result.ok) return failed(result.error);
      update(row.id, { result: result.data });
    }
    changed.current = true;
  }

  async function toggle(row: Row) {
    setBusy(row.id);
    setError(null);
    if (row.itemId) {
      update(row.id, { checked: false });
      const result = await sendJson("DELETE", `/api/study-lists/${row.id}/items/${row.itemId}`);
      if (result.ok) {
        update(row.id, { itemId: null });
        changed.current = true;
      } else {
        update(row.id, { checked: true });
        failed(result.error);
      }
    } else {
      await add(row);
    }
    setBusy(null);
  }

  async function createList() {
    setBusy("create");
    setError(null);
    const created = await sendJson<{ list: StudyListSummaryDto }>("POST", "/api/study-lists", { action: "create", requestId: crypto.randomUUID(), name: name.trim() });
    if (!created.ok) {
      setBusy(null);
      return failed(created.error);
    }
    const row: Row = { id: created.data.list.id!, name: name.trim(), checked: false, itemId: null };
    setRows((current) => [...(current ?? []), row]);
    setName("");
    changed.current = true;
    await add(row);
    setBusy(null);
  }

  const resultText = (result: NonNullable<Row["result"]>) =>
    result.existing > 0 ? l.addedSome(result.added, result.existing) : l.addedAll(result.added);

  return (
    <Dialog
      open
      onClose={close}
      title={l.addTo}
      description={target.kind === "problem" ? l.addOneHelp(target.title) : l.addManyHelp(target.problemIds.length)}
      closeLabel={t.common.close}
      // Focus starts on the lists (announced with the title), not in the new-list field.
      initialFocusRef={listRef}
      footer={
        <Button onClick={close} disabled={busy != null}>
          {t.common.done}
        </Button>
      }
    >
      <div ref={listRef} tabIndex={-1} className="outline-none">
        {rows == null ? (
          <p className="flex items-center gap-2 text-muted">
            <Spinner />
            <span className="sr-only">{t.common.loading}</span>
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted">{l.noListsYet}</p>
        ) : (
          <ul className="-mx-2" aria-label={l.yours}>
            {rows.map((row) => (
              <li key={row.id}>
                {single ? (
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-subtle">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      disabled={busy != null}
                      onChange={() => void toggle(row)}
                      className="h-4 w-4 cursor-pointer rounded border-border accent-accent"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                    {busy === row.id && <Spinner />}
                  </label>
                ) : (
                  <div className="flex min-h-11 items-center gap-3 rounded-lg px-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                    {row.result && (
                      <span role="status" className="inline-flex items-center gap-1 text-xs text-muted">
                        <Check aria-hidden className="h-3.5 w-3.5 text-success" />
                        {resultText(row.result)}
                      </span>
                    )}
                    <Button size="sm" variant="secondary" disabled={busy != null} aria-label={l.addToNamed(row.name)} onClick={() => void toggle(row)}>
                      {busy === row.id && <Spinner />}
                      {l.add}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="mt-4 flex items-center gap-2 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && busy == null) void createList();
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={STUDY_LIST_NAME_MAX}
          placeholder={l.newListName}
          aria-label={l.newListName}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={busy != null || name.trim().length === 0}>
          {busy === "create" && <Spinner />}
          {l.createAndAdd}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
