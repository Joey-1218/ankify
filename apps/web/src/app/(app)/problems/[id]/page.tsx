import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Pin } from "lucide-react";
import type { PracticeSessionDto } from "@ankileet/contracts";
import { SESSION_STALE_AFTER_MS } from "@ankileet/core";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Markdown } from "@/components/ui/markdown";
import { SubmissionList } from "@/components/submission-list";
import { EmptyState } from "@/components/ui/empty-state";
import { ProblemWorkspace, type WorkspacePanel } from "./problem-workspace";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage, getRequestTranslations } from "@/server/i18n";
import { cn, formatRelative } from "@/lib/utils";
import { NotesEditor } from "./notes-editor";
import { MistakeList } from "./mistake-list";
import { DeleteSessionButton } from "./delete-session-button";
import { SessionAnalysis } from "./session-analysis";
import { loadProblemDetail } from "@/server/problem-detail";
import { loadProblemStudyLists } from "@/server/study-lists/lists";
import { ProblemMenu, ProblemPrimaryActions, ProblemsBackLink } from "./problem-actions";
import type { ProblemStudyListsDto } from "@ankileet/contracts";

const RATING_TONES: Record<number, "danger" | "warning" | "success" | "accent" | "neutral"> = { 1: "danger", 2: "warning", 3: "success", 4: "accent" };

function currentTimeMs() {
  return Date.now();
}

/** Finished sessions can be deleted; an interrupted one only once it is stale
 *  history (no activity for 24 hours), since until then it can be resumed. */
function deletable(session: PracticeSessionDto) {
  if (session.status === "completed" || session.status === "abandoned") return true;
  return session.status === "interrupted" && currentTimeMs() - Date.parse(session.timing.lastActivityAt) > SESSION_STALE_AFTER_MS;
}

function ratingLabel(rating: number | null, t: Awaited<ReturnType<typeof getRequestTranslations>>) {
  if (rating === 1) return t.rating.again;
  if (rating === 2) return t.rating.hard;
  if (rating === 3) return t.rating.good;
  if (rating === 4) return t.rating.easy;
  return rating;
}

export const dynamic = "force-dynamic";

export default async function ProblemDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const [t, language] = await Promise.all([getRequestTranslations(), getRequestLanguage()]);
  const { id } = await params;
  const [detail, studyLists] = await Promise.all([loadProblemDetail(user.id, id), loadProblemStudyLists(user.id, id)]);
  if (!detail || !studyLists) notFound();
  const { problem, submissions, timeline, sessions, mistakes } = detail;
  const dateFormat = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const ratingBySession = new Map(timeline.flatMap((event) => (event.kind === "rated" && event.practiceSessionId ? [[event.practiceSessionId, event.rating] as const] : [])));

  const awaitingInitial = problem.enrollment === "awaiting_initial";
  const isDue = !awaitingInitial && (!problem.fsrsDue || new Date(problem.fsrsDue).getTime() <= currentTimeMs());

  const statementPanel = problem.descriptionMd ? (
    <Markdown>{problem.descriptionMd}</Markdown>
  ) : (
    <EmptyState
      title={t.detail.noStatement}
      description={t.detail.statementHelp}
    />
  );

  const submissionsPanel =
    submissions.length === 0 ? (
      <EmptyState title={t.detail.noSubmissions} description={t.detail.submissionsHelp} />
    ) : (
      <SubmissionList submissions={submissions} />
    );

  const historyPanel =
    timeline.length === 0 ? (
      <EmptyState title={t.detail.noReviews} description={t.detail.reviewsHelp} />
    ) : (
      <ul className="divide-y divide-border">
        {timeline.map((event) => (
          <li key={event.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            {event.kind === "rated" ? (
              <Pill tone={RATING_TONES[event.rating!] ?? "neutral"}>{ratingLabel(event.rating, t)}</Pill>
            ) : (
              <Pill tone="accent">{t.sessions.scheduled}</Pill>
            )}
            <span className="text-muted">{formatRelative(event.occurredAt)}</span>
            {event.method && <span className="text-xs text-muted">{t.sessions.methods[event.method] ?? event.method}</span>}
            {event.nextDue && <span className="text-xs text-muted">{t.sessions.nextDue(dateFormat.format(new Date(event.nextDue)))}</span>}
            {event.stability != null && (
              <span className="ml-auto text-xs text-muted tabular-nums">
                s{event.stability.toFixed(1)} d{(event.difficulty ?? 0).toFixed(1)}
              </span>
            )}
          </li>
        ))}
      </ul>
    );

  const sessionsPanel =
    sessions.length === 0 ? (
      <EmptyState title={t.sessions.none} description={t.sessions.noneHelp} />
    ) : (
      <ul className="divide-y divide-border">
        {sessions.map((session) => {
          const state = session.status === "completed" ? (session.outcome ?? "unknown") : session.status;
          const rating = ratingBySession.get(session.id);
          return (
            <li key={session.id} className="space-y-2 py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.dashboard.kinds[session.type] ?? session.type}</span>
                <Pill tone={state === "accepted" ? "success" : state === "failed" ? "danger" : "neutral"}>{t.dashboard.states[state] ?? state}</Pill>
                {rating != null && <Pill tone={RATING_TONES[rating] ?? "neutral"}>{t.sessions.ratedAs(String(ratingLabel(rating, t)))}</Pill>}
                <span className="ml-auto text-xs text-muted">{formatRelative(session.timing.startedAt)}</span>
                {deletable(session) && <DeleteSessionButton session={session} />}
              </div>
              <p className="text-xs text-muted">
                {t.sessions.evidence(session.evidence.submissions, session.evidence.accepted)} · {t.sessions.activeMinutes(Math.round(session.timing.activeMs / 60_000))}
              </p>
              {session.status === "completed" && <SessionAnalysis sessionId={session.id} />}
            </li>
          );
        })}
      </ul>
    );

  const notesPanel = <NotesEditor problemId={problem.id} initialNotes={problem.notes ?? ""} />;

  const mistakesPanel = <MistakeList problemId={problem.id} initialMistakes={mistakes} />;

  const panels: WorkspacePanel[] = [
    { id: "statement", label: t.detail.statement, node: statementPanel },
    { id: "submissions", label: t.review.submissions, count: submissions.length, node: submissionsPanel },
    { id: "mistakes", label: t.mistakes.tab, count: mistakes.length, node: mistakesPanel },
    { id: "sessions", label: t.sessions.tab, count: sessions.length, node: sessionsPanel },
    { id: "history", label: t.detail.history, count: timeline.length, node: historyPanel },
    { id: "notes", label: t.review.notes, node: notesPanel },
  ];

  const lapses = problem.fsrsLapses;
  const nextReview = awaitingInitial ? t.common.notScheduled : isDue ? t.common.now : formatRelative(problem.fsrsDue);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <ProblemsBackLink />
        <ProblemMenu problemId={problem.id} title={problem.title} archived={problem.archivedAt != null} />
      </div>

      <header className="-mt-2 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {problem.leetcodeId != null && <span className="text-muted tabular-nums">{problem.leetcodeId}. </span>}
            {problem.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <DifficultyPill difficulty={problem.difficulty} language={language} />
            <FsrsStatePill state={problem.fsrsState} language={language} />
            {problem.archivedAt != null && <Pill tone="neutral">{t.detail.archived}</Pill>}
            {problem.archivedAt == null && isDue && problem.fsrsReps > 0 && <Pill tone="accent">{t.common.due}</Pill>}
            {problem.topicTags.length > 0 && (
              <span className="ml-1 text-xs text-muted">{problem.topicTags.slice(0, 6).map((tag) => `#${tag}`).join("  ")}</span>
            )}
          </div>
          <ListChips lists={studyLists.memberOf} label={t.lists.memberOf} myProblems={t.lists.myProblems} language={language} />
        </div>
        <ProblemPrimaryActions
          problemId={problem.id}
          title={problem.title}
          url={problem.url}
          archived={problem.archivedAt != null}
          customLists={studyLists.customLists}
        />
      </header>

      {problem.archivedAt != null && (
        <p role="status" className="rounded-lg border border-border bg-subtle px-4 py-2.5 text-sm text-muted">
          {t.detail.archivedNotice}
        </p>
      )}

      <Surface as="section" aria-label={t.detail.scheduling} className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <StatCell label={t.sessions.nextReview} value={nextReview} accent={isDue} hint={!awaitingInitial && problem.fsrsDue ? dateFormat.format(new Date(problem.fsrsDue)) : null} />
          <StatCell label={t.detail.reviews} value={problem.fsrsReps} />
          <StatCell label={t.detail.timesForgotten} value={lapses} danger={lapses > 0} />
          <StatCell label={t.detail.lastReviewed} value={formatRelative(problem.fsrsLastReview)} />
        </dl>
      </Surface>

      <ProblemWorkspace defaultTab="statement" panels={panels} />
    </div>
  );
}

/** "In" and the lists that hold the problem, each a link to its list. */
function ListChips({
  lists,
  label,
  myProblems,
  language,
}: {
  lists: ProblemStudyListsDto["memberOf"];
  label: string;
  myProblems: string;
  language: "en" | "zh";
}) {
  const href = (entry: ProblemStudyListsDto["memberOf"][number]) =>
    (entry.kind === "my_problems" ? "/lists/my-problems" : entry.kind === "builtin" ? `/lists/builtin/${entry.builtinId}` : `/lists/${entry.id}`) as Route;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-0.5 text-muted">{label}</span>
      {lists.map((entry) => (
        <Link
          key={entry.id ?? entry.kind}
          href={href(entry)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium transition hover:border-accent-solid/40 hover:text-accent"
        >
          {entry.kind === "my_problems" && <Pin aria-hidden className="h-3 w-3 text-muted" />}
          {entry.kind === "my_problems" ? myProblems : language === "zh" ? entry.name.zh : entry.name.en}
        </Link>
      ))}
    </div>
  );
}

function StatCell({
  label,
  value,
  hint,
  accent,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("mt-1 text-lg font-semibold tabular-nums", accent && "text-accent", danger && "text-danger")}>{value}</dd>
      {hint && <dd className="text-xs text-muted tabular-nums">{hint}</dd>}
    </div>
  );
}
