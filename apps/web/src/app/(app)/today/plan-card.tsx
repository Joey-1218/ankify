import Link from "next/link";
import type { Route } from "next";
import type { TodayPlanDto } from "@ankileet/contracts";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DifficultyPill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import type { Language, Translation } from "@/lib/i18n";

const pick = (text: { en: string; zh: string }, language: Language) => (language === "zh" ? text.zh : text.en);

/**
 * Today's plan: the day's reviews and the new problems the daily time budget
 * buys, each from an active list with the reason it was picked. "One more"
 * shows the next pick past the plan.
 */
export function PlanCard({ plan, t, language, extra }: { plan: TodayPlanDto; t: Translation; language: Language; extra: number }) {
  const p = t.plan;
  const { pace, settings } = plan;
  const planned = plan.newProblems.filter((problem) => !problem.extra).length;
  const status =
    plan.activeLists === 0
      ? null
      : planned > 0
        ? null
        : pace.newSlots === 0
          ? p.reviewsFirst
          : pace.newStartedToday >= pace.newSlots
            ? p.allStarted
            : p.listsDone;

  return (
    <Surface as="section" aria-label={p.title} className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{p.title}</h2>
          <p className="mt-1 text-sm text-muted tabular-nums">{p.summary(pace.reviews, pace.newSlots, pace.plannedMinutes, settings.dailyMinutes)}</p>
        </div>
        <Link href={"/settings#study-plan" as Route} className="text-sm font-medium text-accent hover:underline">
          {p.adjust}
        </Link>
      </div>

      {plan.activeLists === 0 ? (
        <EmptyState
          title={p.noLists}
          action={
            <Link href="/lists" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              {p.browseLists}
            </Link>
          }
        />
      ) : (
        <>
          {status && <p className="text-sm text-muted">{status}</p>}
          {plan.newProblems.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {plan.newProblems.map((problem) => {
                const reason =
                  problem.reason === "next" || !problem.pattern
                    ? p.reasons.next(pick(problem.list.name, language))
                    : p.reasons[problem.reason](pick(problem.pattern.name, language));
                return (
                  <li key={problem.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {problem.leetcodeId != null && <span className="text-muted tabular-nums">{problem.leetcodeId}. </span>}
                        {pick(problem.title, language)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{reason}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {problem.extra && <Pill>{p.extra}</Pill>}
                      {problem.state === "attempted_before" && <Pill tone="warning">{t.lists.states.attempted_before}</Pill>}
                      <DifficultyPill difficulty={problem.difficulty} language={language} />
                    </span>
                    <a href={problem.url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: problem.extra ? "secondary" : "primary", size: "sm" })}>
                      {p.openOnLeetcode}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          {plan.moreAvailable && (
            <Link href={`/today?more=${extra + 1}` as Route} scroll={false} className={buttonClasses({ variant: "ghost", size: "sm" })}>
              {p.oneMore}
            </Link>
          )}
        </>
      )}

      <p className="text-xs text-muted">
        {pace.ownTimes.review && pace.ownTimes.new ? p.ownTimes(pace.reviewMinutes, pace.newMinutes) : p.defaultTimes(pace.reviewMinutes, pace.newMinutes)}
      </p>
    </Surface>
  );
}
