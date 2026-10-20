import { describe, expect, it } from "vitest";
import { chineseNumeral, outlinePost, parsePost, resolveSiteOnly } from "./study-list-import.mjs";

// A made-up post in the format of the leetcode.cn list posts.
const POST = `
Intro text with a [link](https://leetcode.cn/studyplan/primers-list/).

## 一、Windows

### §1.1 Basics

[A solution link](https://leetcode.cn/problems/two-sum/solutions/1/x/)

- [1. Two Sum](https://leetcode.cn/problems/two-sum/) 1200
- [9. Palindrome Number](https://leetcode.cn/problems/palindrome-number/description/)（会员题）
- [LCP 1. Same Problem](https://leetcode.cn/problems/abcdEF/) 同 1 题

#### Q&A

\`\`\`py
# A code comment, not a heading
- [7. Not a problem](https://leetcode.cn/problems/reverse-integer/)
\`\`\`

**思维扩展**：

- [3. Longest Substring·write-up](https://leetcode.cn/problems/longest-substring-without-repeating-characters/solutions/9/abc/) 约 1700
- [A write-up, not a problem](https://leetcode.cn/problems/two-sum/solution/abc/)

### §1.2 Advanced（选做）

- [LCP 2. Only On CN](https://leetcode.cn/problems/zzZZ/)
- [LCP 3. Same As Elsewhere](https://leetcode.cn/problems/yyYY/) 同 9 题
- [LCP 4. Same As Unlisted](https://leetcode.cn/problems/xxXX/) 同 42 题

## 十二、Loops

**Note**: text.

- [4. Median](https://leetcode.cn/problems/median-of-two-sorted-arrays/) 2100

## 专题：Topic

- [5. Palindromic Substring](https://leetcode.cn/problems/longest-palindromic-substring/)

## 前言

## 思考

- [6. Not Listed](https://leetcode.cn/problems/zigzag-conversion/)
`;

const CONFIG = {
  headings: { "专题：Topic": "t1" },
  sections: { "1.1": { pattern: "a" }, "1.2": { pattern: "a" }, 12: { pattern: "b" }, t1: { pattern: "c" } },
};

describe("study list importer", () => {
  const parsed = parsePost(POST, CONFIG);

  it("reads Chinese chapter numerals", () => {
    expect(["零", "一", "九", "十", "十一", "十五", "二十", "九十九"].map(chineseNumeral)).toEqual([0, 1, 9, 10, 11, 15, 20, 99]);
    expect(chineseNumeral("前言")).toBeNull();
  });

  it("reads problems in order with section, level, and rating, skipping code and write-ups", () => {
    expect(parsed.map((item) => [item.sourceId, item.cnSlug, item.sectionId, item.level, item.rating])).toEqual([
      ["1", "two-sum", "1.1", "core", 1200],
      ["9", "palindrome-number", "1.1", "core", null],
      ["LCP 1", "abcdEF", "1.1", "core", null],
      // An unnumbered sub-heading (Q&A) keeps the section; a problem may link its write-up.
      ["3", "longest-substring-without-repeating-characters", "1.1", "stretch", null],
      // 选做 in the heading marks the section optional.
      ["LCP 2", "zzZZ", "1.2", "optional", null],
      ["LCP 3", "yyYY", "1.2", "optional", null],
      ["LCP 4", "xxXX", "1.2", "optional", null],
      ["4", "median-of-two-sorted-arrays", "12", "core", 2100],
      ["5", "longest-palindromic-substring", "t1", "core", null],
    ]);
  });

  it("outlines every section that opens, with problem counts", () => {
    expect(outlinePost(POST, CONFIG).map((section) => [section.id, section.title, section.optional, section.problems])).toEqual([
      ["1", "Windows", false, 0],
      ["1.1", "Basics", false, 4],
      ["1.2", "Advanced", true, 3],
      ["12", "Loops", false, 1],
      ["t1", "专题：Topic", false, 1],
    ]);
  });

  it("drops leetcode.cn-only problems and uses a named twin once per section", async () => {
    const lookup = async (frontendId) => (frontendId === "42" ? "trapping-rain-water" : null);
    const { kept, excluded } = await resolveSiteOnly(parsed, CONFIG, lookup);
    expect(kept.map((item) => [item.slug, item.frontendId, item.sectionId])).toEqual([
      ["two-sum", "1", "1.1"],
      ["palindrome-number", "9", "1.1"],
      ["longest-substring-without-repeating-characters", "3", "1.1"],
      ["palindrome-number", "9", "1.2"],
      ["trapping-rain-water", "42", "1.2"],
      ["median-of-two-sorted-arrays", "4", "12"],
      ["longest-palindromic-substring", "5", "t1"],
    ]);
    expect(excluded).toEqual([
      { sourceId: "LCP 1", title: "Same Problem", sectionId: "1.1", reason: "same_as", replacedBy: "two-sum" },
      { sourceId: "LCP 2", title: "Only On CN", sectionId: "1.2", reason: "leetcode_cn_only" },
      { sourceId: "LCP 3", title: "Same As Elsewhere", sectionId: "1.2", reason: "same_as", replacedBy: "palindrome-number" },
      { sourceId: "LCP 4", title: "Same As Unlisted", sectionId: "1.2", reason: "same_as", replacedBy: "trapping-rain-water" },
    ]);
  });

  it("fails loudly on unmapped sections, unexpected link formats, and unknown twins", async () => {
    expect(() => parsePost("### §7.7 Unknown\n\n- [1. Two Sum](https://leetcode.cn/problems/two-sum/)", CONFIG)).toThrow(/does not map these sections.*7\.7/);
    expect(() => parsePost("## 前言\n\n- [1. Two Sum](https://leetcode.cn/problems/two-sum/)", CONFIG)).toThrow(/no section/);
    expect(() => parsePost("### §1.1 Basics\n\n- [Two Sum](https://leetcode.cn/problems/two-sum/)", CONFIG)).toThrow(/unexpected format/);
    const unknownTwin = parsePost("### §1.1 B\n\n- [LCP 9. X](https://leetcode.cn/problems/x/) 同 42 题", CONFIG);
    await expect(resolveSiteOnly(unknownTwin, CONFIG)).rejects.toThrow(/replacements/);
  });

  it("keeps a problem once per section when the source repeats it", async () => {
    const repeated = parsePost(
      "### §1.1 B\n\n- [1. Two Sum](https://leetcode.cn/problems/two-sum/)\n\n**Another way**\n\n- [1. Two Sum](https://leetcode.cn/problems/two-sum/)\n\n### §1.2 C\n\n- [1. Two Sum](https://leetcode.cn/problems/two-sum/)",
      CONFIG,
    );
    const { kept } = await resolveSiteOnly(repeated, CONFIG);
    expect(kept.map((item) => [item.slug, item.sectionId])).toEqual([["two-sum", "1.1"], ["two-sum", "1.2"]]);
  });
});
