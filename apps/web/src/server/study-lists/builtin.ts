import { difficultyEnum, leetcodeSlugSchema } from "@ankileet/contracts";
import { z } from "zod";
import binarySearch from "./builtin/binary-search.json";
import bitManipulation from "./builtin/bit-manipulation.json";
import carlArray from "./builtin/carl-array.json";
import carlBacktracking from "./builtin/carl-backtracking.json";
import carlBinaryTree from "./builtin/carl-binary-tree.json";
import carlDynamicProgramming from "./builtin/carl-dynamic-programming.json";
import carlExtra from "./builtin/carl-extra.json";
import carlGreedy from "./builtin/carl-greedy.json";
import carlHashTable from "./builtin/carl-hash-table.json";
import carlLinkedList from "./builtin/carl-linked-list.json";
import carlMonotonicStack from "./builtin/carl-monotonic-stack.json";
import carlStackQueue from "./builtin/carl-stack-queue.json";
import carlString from "./builtin/carl-string.json";
import carlTwoPointers from "./builtin/carl-two-pointers.json";
import dataStructures from "./builtin/data-structures.json";
import dynamicProgramming from "./builtin/dynamic-programming.json";
import graphAlgorithms from "./builtin/graph-algorithms.json";
import greedy from "./builtin/greedy.json";
import gridGraphs from "./builtin/grid-graphs.json";
import linkedListsTreesBacktracking from "./builtin/linked-lists-trees-backtracking.json";
import math from "./builtin/math.json";
import monotonicStack from "./builtin/monotonic-stack.json";
import slidingWindowTwoPointers from "./builtin/sliding-window-two-pointers.json";
import strings from "./builtin/strings.json";
import { isPatternId, type PatternId } from "./patterns";

/**
 * The authors whose lists are built in, in the order /lists shows them.
 * `name` is what the UI shows, in one form for every author and language:
 * the Chinese name, then the English one in parentheses (in English, only an
 * author's name may be Chinese); `source` is the `author` the generated files carry. Ids are
 * stable: they key the remembered open groups on /lists.
 */
export const BUILTIN_AUTHORS = [
  { id: "carl", name: { en: "代码随想录 (Carl)", zh: "代码随想录 (Carl)" }, source: "代码随想录" },
  { id: "endlesscheng", name: { en: "灵茶山艾府 (EndlessCheng)", zh: "灵茶山艾府 (EndlessCheng)" }, source: "灵茶山艾府" },
] as const;

export type BuiltinAuthorId = (typeof BUILTIN_AUTHORS)[number]["id"];

/**
 * Built-in study lists by author, each in its source's order. Each file is
 * generated from a config in `scripts/study-lists/` (never written by hand
 * or by a model): `scripts/study-list-import.mjs` for leetcode.cn posts,
 * `scripts/study-list-import-carl.mjs` for programmercarl.com. To add a
 * list, see DEVELOPMENT.md, "Adding a built-in study list"; builtin.test.ts
 * fails when a file in `builtin/` is not registered here.
 */
const SOURCES: Readonly<Record<BuiltinAuthorId, readonly unknown[]>> = {
  // Carl's core topics in the order of programmercarl.com/algo/ (graph
  // theory is left out: its problems are on Kamacoder), then his extras.
  carl: [
    carlArray,
    carlLinkedList,
    carlHashTable,
    carlString,
    carlTwoPointers,
    carlStackQueue,
    carlBinaryTree,
    carlBacktracking,
    carlGreedy,
    carlDynamicProgramming,
    carlMonotonicStack,
    carlExtra,
  ],
  // 灵茶山艾府's lists, in the order of his index post.
  endlesscheng: [
    slidingWindowTwoPointers,
    binarySearch,
    monotonicStack,
    gridGraphs,
    bitManipulation,
    graphAlgorithms,
    dynamicProgramming,
    dataStructures,
    math,
    greedy,
    linkedListsTreesBacktracking,
    strings,
  ],
};

const localized = z.object({ en: z.string().min(1).max(200), zh: z.string().min(1).max(200) }).strict();

const builtinListSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
    name: localized,
    author: z.string().min(1).max(100),
    sourceUrl: z.string().url().startsWith("https://"),
    sourceUpdatedAt: z.string().nullable(),
    generatedAt: z.string().datetime(),
    /** Where titles, difficulty, and paid flags were read. */
    metadataSite: z.enum(["leetcode.com", "leetcode.cn"]),
    chapters: z.array(z.object({ id: z.string().min(1).max(16), title: localized }).strict()).min(1).max(50),
    sections: z
      .array(
        z
          .object({
            id: z.string().min(1).max(16),
            chapterId: z.string().min(1).max(16),
            title: localized,
            pattern: z.string().refine(isPatternId, "unregistered pattern (add it to patterns.ts)"),
            optional: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    items: z
      .array(
        z
          .object({
            slug: leetcodeSlugSchema,
            frontendId: z.string().regex(/^\d+$/),
            title: localized,
            difficulty: difficultyEnum,
            paidOnly: z.boolean(),
            /** Contest difficulty rating shown in the source, when it shows one. */
            rating: z.number().int().min(800).max(4000).nullable(),
            sectionId: z.string().min(1).max(16),
            /** `optional`: in a section the source marks optional (选做);
             *  `stretch`: under a "further thinking" or "advanced" label. */
            level: z.enum(["core", "optional", "stretch"]),
          })
          .strict(),
      )
      .min(1)
      .max(2_000),
    /** Source problems not on leetcode.com (or not on LeetCode at all), or the same as a listed one. */
    excluded: z
      .array(
        z
          .object({
            sourceId: z.string().min(1).max(32),
            title: z.string().min(1).max(200),
            sectionId: z.string().min(1).max(16),
            reason: z.enum(["leetcode_cn_only", "same_as", "not_on_leetcode"]),
            replacedBy: leetcodeSlugSchema.optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((list, ctx) => {
    const chapters = new Set(list.chapters.map((chapter) => chapter.id));
    const sections = new Set<string>();
    for (const section of list.sections) {
      if (sections.has(section.id)) ctx.addIssue({ code: "custom", message: `duplicate section ${section.id}` });
      if (!chapters.has(section.chapterId)) ctx.addIssue({ code: "custom", message: `section ${section.id}: unknown chapter ${section.chapterId}` });
      sections.add(section.id);
    }
    const placed = new Set<string>();
    for (const item of list.items) {
      if (!sections.has(item.sectionId)) ctx.addIssue({ code: "custom", message: `${item.slug}: unknown section ${item.sectionId}` });
      const key = `${item.sectionId}/${item.slug}`;
      if (placed.has(key)) ctx.addIssue({ code: "custom", message: `${item.slug} appears twice in section ${item.sectionId}` });
      placed.add(key);
    }
  });

type ParsedList = z.infer<typeof builtinListSchema>;

export type BuiltinSection = Omit<ParsedList["sections"][number], "pattern"> & { pattern: PatternId };
export type BuiltinListItem = ParsedList["items"][number] & {
  /** 0-based place in the list's order; a problem in two sections has two. */
  position: number;
  pattern: PatternId;
};
export type BuiltinList = Omit<ParsedList, "sections" | "items"> & {
  authorId: BuiltinAuthorId;
  sections: BuiltinSection[];
  items: BuiltinListItem[];
};

export function parseBuiltinList(raw: unknown, authorId: BuiltinAuthorId = "endlesscheng"): BuiltinList {
  const list = builtinListSchema.parse(raw);
  const sections = list.sections as BuiltinSection[];
  const patternOf = new Map(sections.map((section) => [section.id, section.pattern]));
  return {
    ...list,
    authorId,
    sections,
    items: list.items.map((item, position) => ({ ...item, position, pattern: patternOf.get(item.sectionId)! })),
  };
}

let cached: {
  lists: BuiltinList[];
  byId: Map<string, BuiltinList>;
  patternsBySlug: Map<string, PatternId[]>;
  problemBySlug: Map<string, BuiltinListItem>;
} | null = null;

function load() {
  if (cached) return cached;
  const lists = BUILTIN_AUTHORS.flatMap((author) =>
    SOURCES[author.id].map((raw) => {
      const list = parseBuiltinList(raw, author.id);
      if (list.author !== author.source) throw new Error(`${list.id} is registered under ${author.id} but its author is ${list.author}.`);
      return list;
    }),
  );
  const byId = new Map<string, BuiltinList>();
  const patternsBySlug = new Map<string, PatternId[]>();
  const problemBySlug = new Map<string, BuiltinListItem>();
  for (const list of lists) {
    if (byId.has(list.id)) throw new Error(`Two built-in study lists share the id ${list.id}.`);
    byId.set(list.id, list);
    for (const item of list.items) {
      const patterns = patternsBySlug.get(item.slug) ?? [];
      if (!patterns.includes(item.pattern)) patterns.push(item.pattern);
      patternsBySlug.set(item.slug, patterns);
      if (!problemBySlug.has(item.slug)) problemBySlug.set(item.slug, item);
    }
  }
  cached = { lists, byId, patternsBySlug, problemBySlug };
  return cached;
}

/** A problem's metadata as the built-in lists hold it (read from LeetCode), or null. */
export function builtinProblem(slug: string): BuiltinListItem | null {
  return load().problemBySlug.get(slug) ?? null;
}

/** Every built-in list, in display order (by author, then the source's order). */
export function builtinLists(): readonly BuiltinList[] {
  return load().lists;
}

export function getBuiltinList(id: string): BuiltinList | null {
  return load().byId.get(id) ?? null;
}

/**
 * A problem's patterns: those of every built-in section containing it,
 * whether or not the user follows that list. Empty for any other problem.
 */
export function patternsForSlug(slug: string): readonly PatternId[] {
  return load().patternsBySlug.get(slug) ?? [];
}

/** An author's display name; built-in lists show it, never their file's `author`. */
export function builtinAuthorName(authorId: BuiltinAuthorId) {
  return BUILTIN_AUTHORS.find((author) => author.id === authorId)!.name;
}
