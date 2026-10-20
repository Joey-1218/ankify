import { describe, expect, it } from "vitest";
import { parsePost, resolveSiteOnly } from "./study-list-import.mjs";

// A made-up post in the format of the leetcode.cn list posts.
const POST = `
Intro text with a [link](https://leetcode.cn/studyplan/primers-list/).

## 一、Windows

### §1.1 Basics

[A solution link](https://leetcode.cn/problems/two-sum/solutions/1/x/)

- [1. Two Sum](https://leetcode.cn/problems/two-sum/) 1200
- [9. Palindrome Number](https://leetcode.cn/problems/palindrome-number/description/)（会员题）
- [LCP 1. Same Problem](https://leetcode.cn/problems/abcdEF/) 同 1 题

**思维扩展**：

- [3. Longest Substring](https://leetcode.cn/problems/longest-substring-without-repeating-characters/) 约 1700

### §1.2 Advanced（选做）

- [LCP 2. Only On CN](https://leetcode.cn/problems/zzZZ/)
- [LCP 3. Same As Elsewhere](https://leetcode.cn/problems/yyYY/) 同 9 题

## 二、Loops

**Note**: text.

- [4. Median](https://leetcode.cn/problems/median-of-two-sorted-arrays/) 2100

## 思考

- [5. Not Listed](https://leetcode.cn/problems/longest-palindromic-substring/)
`;

const CONFIG = {
  stopAtHeading: "思考",
  stretchLabels: ["思维扩展", "进阶"],
  sections: { "1.1": { pattern: "a" }, "1.2": { pattern: "a", optional: true }, 2: { pattern: "b" } },
};

describe("study list importer", () => {
  const parsed = parsePost(POST, CONFIG);

  it("reads problems in order with section, level, and rating, and stops at the stop heading", () => {
    expect(parsed.map((item) => [item.sourceId, item.cnSlug, item.sectionId, item.level, item.rating])).toEqual([
      ["1", "two-sum", "1.1", "core", 1200],
      ["9", "palindrome-number", "1.1", "core", null],
      ["LCP 1", "abcdEF", "1.1", "core", null],
      ["3", "longest-substring-without-repeating-characters", "1.1", "stretch", null],
      ["LCP 2", "zzZZ", "1.2", "optional", null],
      ["LCP 3", "yyYY", "1.2", "optional", null],
      ["4", "median-of-two-sorted-arrays", "2", "core", 2100],
    ]);
  });

  it("drops leetcode.cn-only problems and uses a named twin once per section", () => {
    const { kept, excluded } = resolveSiteOnly(parsed, CONFIG);
    expect(kept.map((item) => [item.slug, item.sectionId])).toEqual([
      ["two-sum", "1.1"],
      ["palindrome-number", "1.1"],
      ["longest-substring-without-repeating-characters", "1.1"],
      ["palindrome-number", "1.2"],
      ["median-of-two-sorted-arrays", "2"],
    ]);
    expect(excluded).toEqual([
      { sourceId: "LCP 1", title: "Same Problem", sectionId: "1.1", reason: "same_as", replacedBy: "two-sum" },
      { sourceId: "LCP 2", title: "Only On CN", sectionId: "1.2", reason: "leetcode_cn_only" },
      { sourceId: "LCP 3", title: "Same As Elsewhere", sectionId: "1.2", reason: "same_as", replacedBy: "palindrome-number" },
    ]);
  });

  it("fails loudly on an unmapped section or an unexpected link format", () => {
    expect(() => parsePost("### §7.7 Unknown\n\n- [1. Two Sum](https://leetcode.cn/problems/two-sum/)", CONFIG)).toThrow(/does not map/);
    expect(() => parsePost("### §1.1 Basics\n\n- [Two Sum](https://leetcode.cn/problems/two-sum/)", CONFIG)).toThrow(/unexpected format/);
    expect(() => resolveSiteOnly(parsePost("### §1.1 B\n\n- [LCP 9. X](https://leetcode.cn/problems/x/) 同 42 题", CONFIG), CONFIG)).toThrow(/replacements/);
  });
});
