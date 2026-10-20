import { describe, expect, it } from "vitest";
import { collectItems, pageContent, parseArticle, parseTopicPage } from "./study-list-import-carl.mjs";

// Made-up pages in the layout of programmercarl.com (VuePress).
const page = (body) => `<html><aside class="sidebar"><a href="/algo/array/9999-sidebar-only.html">x</a></aside>
<main><div class="theme-default-content content__default">${body}</div><footer class="page-edit"></footer>
<div class="page-nav"><a href="/algo/next/0001-next.html">next</a></div></main></html>`;

const TOPIC = page(`<h1>Topic</h1><h1>学习顺序</h1><ol>
<li><a href="/algo/array/array-basics.html">Basics</a></li>
<li><a href="/algo/array/0001-two-sum.html">1. Two Sum</a></li>
<li><a href="/algo/string/0344-reverse-string.html">344. Reverse</a></li>
<li><a href="/algo/array/0001-two-sum.html">again</a></li>
<li><a href="/algo/array/kamacoder-0058-range-sum.html">58. Range sum</a></li>
</ol>`);

const ARTICLE = page(`<h1 id="t"><a class="header-anchor">#</a> 1. Two Sum</h1>
<p><a href="https://leetcode.cn/problems/two-sum/" target="_blank">力扣题目链接</a></p>
<h2>思路</h2><p>See <a href="https://leetcode.cn/problems/two-sum/description/">again</a>.</p>
<h2>相关题目推荐</h2><ul>
<li><a href="https://leetcode.cn/problems/3sum/">15. 3Sum</a></li>
<li><a href="https://leetcode.cn/problems/4sum/">18. 4Sum</a></li></ul>
<h2>其他语言版本</h2><p><a href="https://github.com/youngyangyang04/leetcode-master">repo</a></p>`);

describe("programmercarl.com importer", () => {
  it("reads only the article body", () => {
    expect(pageContent(TOPIC)).not.toContain("sidebar-only");
    expect(pageContent(TOPIC)).not.toContain("0001-next");
  });

  it("lists a topic's articles once, in order, across topics", () => {
    expect(parseTopicPage(TOPIC).map((article) => article.stem)).toEqual(["array-basics", "0001-two-sum", "0344-reverse-string", "kamacoder-0058-range-sum"]);
  });

  it("marks an article's own problem core and its related ones stretch", () => {
    const article = parseArticle(ARTICLE);
    expect(article.title).toBe("1. Two Sum");
    expect(article.problems.map((problem) => [problem.cnSlug, problem.level])).toEqual([
      ["two-sum", "core"],
      ["3sum", "stretch"],
      ["4sum", "stretch"],
    ]);
  });

  it("keeps a problem once per list, prefers core, and accounts for articles without one", () => {
    const articles = [
      { stem: "0001-two-sum", title: "1. Two Sum", problems: parseArticle(ARTICLE).problems },
      { stem: "weekly-review-1", title: "Review", problems: [{ cnSlug: "two-sum", level: "core" }] },
      { stem: "0015-3sum", title: "15. 3Sum", problems: [{ cnSlug: "3sum", level: "core" }, { cnSlug: "two-sum", level: "stretch" }] },
      { stem: "0207-course-schedule", title: "207", problems: [] },
      { stem: "kamacoder-0058-range-sum", title: "58", problems: [] },
      { stem: "array-summary", title: "Summary", problems: [] },
    ];
    const config = {
      articles: { "0001-two-sum": "1.1", "weekly-review-1": null, "0015-3sum": "1.2", "0207-course-schedule": "1.2", "kamacoder-0058-range-sum": "1.2" },
      sections: { "1.1": {}, "1.2": {} },
    };
    const { items, noProblem } = collectItems(articles, config);
    expect(items.map((item) => [item.cnSlug, item.sectionId, item.level, item.frontendId])).toEqual([
      ["two-sum", "1.1", "core", null],
      ["4sum", "1.1", "stretch", null],
      ["3sum", "1.2", "core", null],
      // Named after a problem it does not link: its number is checked on import.
      ["course-schedule", "1.2", "core", "207"],
    ]);
    expect(noProblem.map((article) => article.stem)).toEqual(["kamacoder-0058-range-sum"]);
  });

  it("refuses an article with problems that the config does not map", () => {
    const articles = [{ stem: "0001-two-sum", title: "1", problems: [{ cnSlug: "two-sum", level: "core" }] }];
    expect(() => collectItems(articles, { articles: {}, sections: {} })).toThrow(/0001-two-sum/);
  });
});
