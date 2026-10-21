import { Fragment } from "react";
import { skillDimensionEnum, type PatternProfileDto, type PatternStatDto } from "@ankileet/contracts";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import type { Language, Translation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const pick = (text: { en: string; zh: string }, language: Language) => (language === "zh" ? text.zh : text.en);

/** Darker as a cause recurs: 1, 2, then 3 or more confirmed sessions. */
function heatClass(count: number) {
  return count >= 3 ? "bg-danger/35 font-semibold" : count === 2 ? "bg-danger/20 font-medium" : "bg-danger/10";
}

function status(stat: PatternStatDto, s: Translation["profile"]["patternStatus"]) {
  if (stat.weak) return <Pill tone="warning">{s.weak}</Pill>;
  if (stat.strong) return <Pill tone="success">{s.strong}</Pill>;
  return <Pill>{stat.ready ? s.steady : s.tooFew}</Pill>;
}

/**
 * The pattern x cause grid (GET /api/mistakes/patterns): one row per pattern
 * with evidence, weak ones first, and a column per confirmed cause, shaded by
 * how often it happened. A weak pattern lists problems to practice it next.
 * On a phone the table scrolls inside its panel; the pattern column stays put.
 */
export function PatternGrid({ profile, t, language }: { profile: PatternProfileDto; t: Translation; language: Language }) {
  const p = t.profile;
  const causes = skillDimensionEnum.options.filter((cause) => profile.patterns.some((stat) => (stat.causes[cause] ?? 0) > 0));
  const columns = 4 + causes.length;
  const head = "px-3 py-2 font-medium whitespace-nowrap";
  return (
    <Surface as="section" aria-label={p.patterns} className="overflow-hidden">
      <div className="p-5 pb-4">
        <h3 className="text-base font-semibold">{p.patterns}</h3>
        <p className="mt-1 text-sm text-muted">{p.patternsHelp(profile.required.sessions, profile.required.problems)}</p>
      </div>
      {profile.patterns.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState title={p.noPatterns} description={p.noPatternsHelp} />
        </div>
      ) : (
        <>
          {causes.length === 0 && <p className="px-5 pb-4 text-sm text-muted">{p.noPatternCauses}</p>}
          {/* relative: the cells' sr-only text is clipped here too, so it never widens the page. */}
          <div className="relative overflow-x-auto border-t border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-subtle text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className={cn(head, "sticky left-0 z-10 bg-subtle pl-5")}>{p.patternColumn}</th>
                  <th scope="col" className={head}>{p.statusColumn}</th>
                  <th scope="col" className={cn(head, "text-right")}>{p.sessionsProblemsColumn}</th>
                  <th scope="col" className={cn(head, "text-right")}>{p.newFirstTryColumn}</th>
                  {causes.map((cause) => (
                    <th key={cause} scope="col" className={cn(head, "text-center")}>
                      {t.mistakes.categories[cause]}
                    </th>
                  ))}
                </tr>
              </thead>
              {profile.patterns.map((stat) => (
                <tbody key={stat.pattern.id} className="border-b border-border last:border-b-0">
                  <tr>
                    <th scope="row" className="sticky left-0 z-10 min-w-40 max-w-56 bg-surface py-3 pl-5 pr-3 font-medium">
                      {pick(stat.pattern.name, language)}
                    </th>
                    <td className="px-3 py-3">{status(stat, p.patternStatus)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {stat.sessions} / {stat.problems}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                      {stat.newProblems.total > 0 ? p.ofTotal(stat.newProblems.firstTry, stat.newProblems.total) : "—"}
                    </td>
                    {causes.map((cause) => {
                      const count = stat.causes[cause] ?? 0;
                      return count > 0 ? (
                        <td key={cause} className={cn("px-3 py-3 text-center tabular-nums", heatClass(count))}>
                          {count}
                        </td>
                      ) : (
                        <td key={cause} className="px-3 py-3 text-center text-muted">
                          <span aria-hidden>·</span>
                          <span className="sr-only">{p.noCause}</span>
                        </td>
                      );
                    })}
                  </tr>
                  {stat.weak && (
                    <tr>
                      <td colSpan={columns} className="px-5 pb-3 pt-0">
                        {/* Pinned to the panel's left edge, as wide as it, while the cells scroll. */}
                        <div className="sticky left-5 max-w-[calc(100vw-5.5rem)] text-sm sm:max-w-none">
                          {stat.next.length === 0 ? (
                            <p className="text-muted">{p.usedUp}</p>
                          ) : (
                            <p>
                              <span className="text-muted">{p.practiceNext} </span>
                              {stat.next.map((problem, index) => (
                                <Fragment key={problem.slug}>
                                  {index > 0 && <span className="text-muted"> · </span>}
                                  <a
                                    href={problem.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                                  >
                                    {problem.leetcodeId}. {pick(problem.title, language)}
                                  </a>
                                  {/* A run of problems from one list names it once, after the run. */}
                                  {stat.next[index + 1]?.list.builtinId !== problem.list.builtinId && (
                                    <span className="text-muted"> ({pick(problem.list.name, language)})</span>
                                  )}
                                </Fragment>
                              ))}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
    </Surface>
  );
}
