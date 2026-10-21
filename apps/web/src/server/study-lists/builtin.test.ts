import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_AUTHORS, builtinLists, getBuiltinList, parseBuiltinList, patternsForSlug } from "./builtin";
import { PATTERNS } from "./patterns";

const here = path.dirname(fileURLToPath(import.meta.url));
const builtinDir = path.join(here, "builtin");
const configDir = path.join(here, "../../../../../scripts/study-lists");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

const minimal = () => ({
  id: "demo-list",
  name: { en: "Demo", zh: "演示" },
  author: "someone",
  sourceUrl: "https://leetcode.cn/discuss/post/1/demo/",
  sourceUpdatedAt: null,
  generatedAt: "2026-10-20T00:00:00.000Z",
  metadataSite: "leetcode.com",
  chapters: [{ id: "1", title: { en: "Windows", zh: "窗口" } }],
  sections: [
    { id: "1.1", chapterId: "1", title: { en: "Basics", zh: "基础" }, pattern: "sliding_window.fixed", optional: false },
    { id: "1.2", chapterId: "1", title: { en: "Longest", zh: "最长" }, pattern: "sliding_window.variable.longest", optional: true },
  ],
  items: [
    { slug: "two-sum", frontendId: "1", title: { en: "Two Sum", zh: "两数之和" }, difficulty: "Easy", paidOnly: false, rating: null, sectionId: "1.1", level: "core" },
    { slug: "two-sum", frontendId: "1", title: { en: "Two Sum", zh: "两数之和" }, difficulty: "Easy", paidOnly: false, rating: 1200, sectionId: "1.2", level: "optional" },
  ],
  excluded: [],
});

describe("built-in study lists", () => {
  it("registers every generated file, under unique ids", () => {
    const files = readdirSync(builtinDir).filter((file) => file.endsWith(".json"));
    const registered = builtinLists().map((list) => `${list.id}.json`);
    expect(registered.sort()).toEqual(files.sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it("has a generated list for every import config, matching its sections and patterns", () => {
    for (const file of readdirSync(configDir).filter((name) => name.endsWith(".json"))) {
      const config = readJson(path.join(configDir, file)) as { id: string; sections: Record<string, { pattern: string; optional?: boolean }> };
      const list = getBuiltinList(config.id);
      expect(list, `${file}: run the importer (DEVELOPMENT.md, "Adding a built-in study list")`).not.toBeNull();
      for (const section of list!.sections) {
        // A config edit is not live until the list is regenerated.
        expect(config.sections[section.id], `${config.id} section ${section.id}`).toMatchObject({ pattern: section.pattern });
        // Optional comes from the config or the source's 选做 marker.
        if (config.sections[section.id]!.optional) expect(section.optional).toBe(true);
      }
    }
  });

  it("registers every list under a known author, authors in display order", () => {
    const authors = BUILTIN_AUTHORS.map((author) => author.id);
    const order = builtinLists().map((list) => authors.indexOf(list.authorId));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const author of BUILTIN_AUTHORS) expect(builtinLists().some((list) => list.authorId === author.id), author.id).toBe(true);
  });

  // We borrow the lists and their order, not the source's wording: in
  // English, only an author's own name may be Chinese.
  it("has no Chinese in any English label", () => {
    const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;
    for (const list of builtinLists()) {
      const labels = [
        ["name", list.name.en],
        ...list.chapters.map((chapter) => [`chapter ${chapter.id}`, chapter.title.en]),
        ...list.sections.map((section) => [`section ${section.id}`, section.title.en]),
        ...list.items.map((item) => [item.slug, item.title.en]),
      ];
      for (const [where, text] of labels) expect(cjk.test(text!), `${list.id} ${where}: ${text}`).toBe(false);
    }
    for (const [id, name] of Object.entries(PATTERNS)) expect(cjk.test(name.en), id).toBe(false);
  });

  it("names every pattern in both languages", () => {
    for (const [id, name] of Object.entries(PATTERNS)) {
      expect(name.en.length, id).toBeGreaterThan(0);
      expect(name.zh.length, id).toBeGreaterThan(0);
    }
  });

  it("keeps list order and gives each item its section's pattern", () => {
    const list = parseBuiltinList(minimal());
    expect(list.items.map((item) => [item.position, item.sectionId, item.pattern])).toEqual([
      [0, "1.1", "sliding_window.fixed"],
      [1, "1.2", "sliding_window.variable.longest"],
    ]);
  });

  it("rejects unregistered patterns, unknown sections or chapters, and repeats within a section", () => {
    const cases: Array<(list: ReturnType<typeof minimal>) => void> = [
      (list) => void (list.sections[0]!.pattern = "made_up.pattern"),
      (list) => void (list.items[0]!.sectionId = "9.9"),
      (list) => void (list.sections[0]!.chapterId = "9"),
      (list) => void (list.items[1]!.sectionId = "1.1"),
      (list) => void (list.items[0]!.slug = "Two Sum"),
      (list) => void (list.items[0]!.level = "bonus"),
    ];
    for (const change of cases) {
      const list = minimal();
      change(list);
      expect(() => parseBuiltinList(list)).toThrow();
    }
  });

  it("gives a problem listed in two sections both patterns, and other problems none", () => {
    const list = getBuiltinList("sliding-window-two-pointers")!;
    const counts = new Map<string, number>();
    for (const item of list.items) counts.set(item.slug, (counts.get(item.slug) ?? 0) + 1);
    const twice = [...counts].find(([, count]) => count > 1)![0];
    const sections = list.items.filter((item) => item.slug === twice).map((item) => item.pattern);
    expect(patternsForSlug(twice)).toEqual(expect.arrayContaining([...new Set(sections)]));
    // Every list counts, followed or not.
    const everywhere = builtinLists().flatMap((other) => other.items.filter((item) => item.slug === twice).map((item) => item.pattern));
    expect([...patternsForSlug(twice)].sort()).toEqual([...new Set(everywhere)].sort());
    expect(patternsForSlug("not-in-any-list")).toEqual([]);
  });
});

describe("the first built-in list", () => {
  const list = getBuiltinList("sliding-window-two-pointers")!;

  it("holds only leetcode.com problems, with the leetcode.cn-only ones accounted for", () => {
    expect(list.items.every((item) => /^\d+$/.test(item.frontendId))).toBe(true);
    expect(list.excluded.map((entry) => entry.sourceId).sort()).toEqual(["LCP 18", "LCP 28", "LCP 68", "LCR 180", "面试题 16.06"].sort());
    // LCP 28 is the same as 2824, which the same section already lists.
    expect(list.excluded.find((entry) => entry.sourceId === "LCP 28")).toMatchObject({ reason: "same_as", replacedBy: "count-pairs-whose-sum-is-less-than-target" });
    expect(list.items.filter((item) => item.slug === "count-pairs-whose-sum-is-less-than-target")).toHaveLength(1);
  });

  it("covers every section of the source in order", () => {
    expect(list.sections.map((section) => section.id)).toEqual([
      "1.1", "1.2", "2.1.1", "2.1.2", "2.2", "2.3.1", "2.3.2", "2.3.3", "2.4",
      "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "4.1", "4.2", "5", "6",
    ]);
    const order = list.sections.map((section) => section.id);
    const positions = list.items.map((item) => order.indexOf(item.sectionId));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("Carl's lists", () => {
  it("hold only leetcode.com problems, once per list, with the rest accounted for", () => {
    const carl = builtinLists().filter((list) => list.authorId === "carl");
    expect(carl).toHaveLength(12);
    for (const list of carl) {
      expect(new Set(list.items.map((item) => item.slug)).size, list.id).toBe(list.items.length);
    }
    // 面试题 02.07 is leetcode.cn only; Kamacoder problems are not on LeetCode.
    expect(getBuiltinList("carl-linked-list")!.excluded).toMatchObject([{ sourceId: "面试题 02.07", reason: "leetcode_cn_only" }]);
    expect(getBuiltinList("carl-string")!.excluded.map((entry) => entry.reason)).toEqual(["not_on_leetcode", "not_on_leetcode"]);
  });

  it("puts an article's own problem first and its related ones after, as stretch", () => {
    const array = getBuiltinList("carl-array")!;
    const removal = array.items.filter((item) => item.sectionId === "1.2").map((item) => [item.slug, item.level]);
    expect(removal[0]).toEqual(["remove-element", "core"]);
    // 977 has its own article later, so it is core there and not repeated here.
    expect(removal.map(([slug]) => slug)).not.toContain("squares-of-a-sorted-array");
    expect(array.items.find((item) => item.slug === "squares-of-a-sorted-array")).toMatchObject({ sectionId: "1.3", level: "core" });
  });
});
