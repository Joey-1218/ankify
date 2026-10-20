import { z } from "zod";
import { leetcodeSlugSchema } from "./schemas";

/**
 * Study lists: built-in lists (committed data, followed by reference),
 * playlist-style custom lists, and My problems (every problem in no other
 * list). Progress is derived per user on read from the problems by slug.
 */

export const STUDY_LIST_NAME_MAX = 80;
export const STUDY_LIST_SHARE_MAX = 10;

const listName = z.string().trim().min(1).max(STUDY_LIST_NAME_MAX);
const builtinId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const rowId = z.string().min(1).max(64);

/** POST /api/study-lists — create a custom list, follow a built-in one, or copy one. Idempotent per `requestId`. */
export const studyListCreateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestId: z.string().uuid(), name: listName }).strict(),
  z.object({ action: z.literal("follow"), requestId: z.string().uuid(), builtinId }).strict(),
  z.object({ action: z.literal("copy"), requestId: z.string().uuid(), builtinId, name: listName }).strict(),
]);
export type StudyListCreateInput = z.infer<typeof studyListCreateSchema>;

/** PATCH /api/study-lists/:id — rename (custom only), pause, or reweight. */
export const studyListPatchSchema = z
  .object({
    name: listName.optional(),
    active: z.boolean().optional(),
    share: z.number().int().min(1).max(STUDY_LIST_SHARE_MAX).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });
export type StudyListPatchInput = z.infer<typeof studyListPatchSchema>;

/**
 * POST /api/study-lists/:id/items — add a problem to a custom list: one in the
 * deck (by id) or one from a built-in list (by slug). Titles and difficulty
 * always come from the server's own data, never from the request.
 */
export const studyListItemAddSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("problem"), problemId: rowId }).strict(),
  z.object({ source: z.literal("builtin"), slug: leetcodeSlugSchema }).strict(),
]);
export type StudyListItemAddInput = z.infer<typeof studyListItemAddSchema>;

/** PUT /api/study-lists/:id/items — the list's new order: every item id, once. */
export const studyListOrderSchema = z.object({ itemIds: z.array(rowId).max(2_000) }).strict();
export type StudyListOrderInput = z.infer<typeof studyListOrderSchema>;

/** PUT /api/study-lists — the order of the user's lists (My problems stays first): every list id, once. */
export const studyListsOrderSchema = z.object({ listIds: z.array(rowId).max(50) }).strict();
export type StudyListsOrderInput = z.infer<typeof studyListsOrderSchema>;

export type LocalizedTextDto = { en: string; zh: string };

export type StudyListKind = "my_problems" | "custom" | "builtin";

/**
 * A problem's place in the user's practice, derived on read:
 * `attempted_before`: known attempted (LeetCode history, marked, or deleted
 * here) but not in the deck; `in_progress`: first practice not finished yet;
 * `learned`: in the review schedule; `archived`: retired from review.
 */
export type StudyListEntryState = "not_started" | "attempted_before" | "in_progress" | "learned" | "archived";

/** Counts of distinct problems (a problem in two sections counts once). */
export type StudyListProgressDto = { total: number; started: number; learned: number };

export type StudyListEntryDto = {
  /** Stable within the list: item id (custom), `section/slug` (built-in), or problem id (My problems). */
  key: string;
  /** The custom list item, for removing and reordering. */
  itemId: string | null;
  slug: string;
  leetcodeId: number | null;
  title: LocalizedTextDto;
  difficulty: "Easy" | "Medium" | "Hard";
  url: string;
  /** Built-in entries only. */
  paidOnly: boolean | null;
  rating: number | null;
  level: "core" | "optional" | "stretch" | null;
  sectionId: string | null;
  state: StudyListEntryState;
  problemId: string | null;
};

export type StudyListSummaryDto = {
  /** The study_lists row; null for My problems and for a built-in list not followed. */
  id: string | null;
  kind: StudyListKind;
  builtinId: string | null;
  name: LocalizedTextDto;
  /** A built-in list's author, as the UI shows it. */
  author: LocalizedTextDto | null;
  sourceUrl: string | null;
  followed: boolean;
  active: boolean;
  share: number;
  progress: StudyListProgressDto;
  /** The first entry in list order not started yet (attempted-before ones included). */
  nextUp: StudyListEntryDto | null;
};

export type StudyListPatternDto = { id: string; name: LocalizedTextDto };

export type StudyListChapterDto = { id: string; title: LocalizedTextDto };

export type StudyListSectionDto = {
  id: string;
  chapterId: string;
  title: LocalizedTextDto;
  pattern: StudyListPatternDto;
  optional: boolean;
};

export type StudyListDetailDto = {
  list: StudyListSummaryDto;
  /** Built-in lists only; empty otherwise. */
  chapters: StudyListChapterDto[];
  sections: StudyListSectionDto[];
  entries: StudyListEntryDto[];
  /** Problems of the source that are not on leetcode.com, so not included. */
  excludedCount: number;
  /** The user's custom lists, as targets for "Add to list". */
  customLists: { id: string; name: string }[];
};

export type StudyListsOverviewDto = {
  /** My problems first, then the user's lists in their order. */
  lists: StudyListSummaryDto[];
  /** Every built-in list, followed or not, grouped by author in display order. */
  builtinGroups: StudyListAuthorGroupDto[];
};

export type StudyListAuthorGroupDto = { authorId: string; name: LocalizedTextDto; lists: StudyListSummaryDto[] };

/** A problem's lists, for its page: where it is, and where it could go. */
export type ProblemStudyListsDto = {
  slug: string;
  memberOf: { id: string | null; kind: StudyListKind; name: LocalizedTextDto; builtinId: string | null }[];
  customLists: { id: string; name: string; contains: boolean }[];
};

/** Why a new problem is on today's plan. */
export type TodayPickReason =
  /** The next problem of a pattern that keeps failing: practice on fresh problems. */
  | "weak_pattern"
  /** An unseen problem of a pattern that looks strong: a first-try solve confirms it. */
  | "check"
  /** The list's next problem in order. */
  | "next";

export type TodayNewProblemDto = {
  slug: string;
  leetcodeId: number | null;
  title: LocalizedTextDto;
  difficulty: "Easy" | "Medium" | "Hard";
  url: string;
  state: "not_started" | "attempted_before";
  list: { id: string; kind: "custom" | "builtin"; builtinId: string | null; name: LocalizedTextDto };
  pattern: StudyListPatternDto | null;
  reason: TodayPickReason;
  /** Past the day's plan ("one more new problem"). */
  extra: boolean;
};

export type TodayPlanDto = {
  dateKey: string;
  settings: { dailyMinutes: number; maxNewPerDay: number; hidePatternsOnToday: boolean };
  pace: {
    /** Reviews the day holds: due now within the daily limit, plus those done today. */
    reviews: number;
    reviewMinutes: number;
    newMinutes: number;
    /** Whether the typical times are the user's own medians (else defaults). */
    ownTimes: { review: boolean; new: boolean };
    /** New problems the budget buys today, including those already started. */
    newSlots: number;
    newStartedToday: number;
    plannedMinutes: number;
  };
  activeLists: number;
  /** Planned new problems still to start, then any extras asked for. */
  newProblems: TodayNewProblemDto[];
  /** Whether a list still has a problem to offer past these. */
  moreAvailable: boolean;
  /** Due problem ids in today's interleaved order. */
  reviewOrder: string[];
  /** Patterns of due problems, only when Today shows them. */
  reviewPatterns: Record<string, StudyListPatternDto[]>;
};
