#!/usr/bin/env node
/*
 * Built-in study list importer for 代码随想录 (programmercarl.com), read-only.
 *
 * Builds apps/web/src/server/study-lists/builtin/<id>.json from one topic
 * page (`/algo/<topic>/`) and a hand-written config in
 * scripts/study-lists/<id>.json. Kept from the site: the order of the
 * articles and the LeetCode problems each one links. Nothing of the
 * articles' text is copied: list, chapter, and section names are the
 * config's own English and Chinese labels, and problem metadata (English
 * title, difficulty, paid flag, frontend id) is read from leetcode.com, the
 * Chinese title from leetcode.cn.
 *
 * Each article is mapped to a section by the config's `articles`
 * (file name without .html -> section id). Within an article, problems
 * linked as the article's own (力扣题目链接, or a heading's problem) are
 * `core`; those under a 相关题目 heading are `stretch`, and a stretch link is
 * dropped when the list has the problem as core elsewhere. A problem already
 * in the list is not repeated. Problems that are not on leetcode.com
 * (面试题, 剑指 Offer) and articles with no LeetCode problem (卡码网) are
 * listed under `excluded`.
 *
 * Usage:
 *   node scripts/study-list-import-carl.mjs <config.json> [--cache dir] [--out file]
 *   node scripts/study-list-import-carl.mjs --init <topic-url> <list-id> [--cache dir]
 *     writes scripts/study-lists/<list-id>.json with one section per article,
 *     Chinese titles filled in; group articles and add English labels and
 *     patterns by hand.
 *
 * --cache keeps the fetched pages (the site resets connections now and then).
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMetadata } from "./study-list-import.mjs";

const ORIGIN = "https://programmercarl.com";
const USER_AGENT = "Mozilla/5.0 (ankileet study-list importer)";
const CJK = /[㐀-鿿]/;

const decode = (text) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The page's article body (VuePress `theme-default-content`), without sidebar, nav, or comments. */
export function pageContent(html) {
  const start = html.indexOf('class="theme-default-content');
  if (start < 0) throw new Error("The page has no theme-default-content block; its layout changed.");
  const ends = ['class="page-edit"', 'class="page-nav"', "</main>"].map((marker) => html.indexOf(marker, start)).filter((i) => i > 0);
  return html.slice(start, ends.length ? Math.min(...ends) : undefined);
}

/** A topic page's articles in order: `{ path, stem, title }`. */
export function parseTopicPage(html) {
  const articles = [];
  for (const match of pageContent(html).matchAll(/<a href="(\/algo\/[a-z0-9-]+\/([a-z0-9-]+)\.html)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (articles.some((article) => article.path === match[1])) continue;
    articles.push({ path: match[1], stem: match[2], title: decode(match[3]) });
  }
  return articles;
}

/** An article's title and LeetCode problems in page order: `{ title, problems: [{ cnSlug, level, text }] }`. */
export function parseArticle(html) {
  const content = pageContent(html);
  const title = decode(content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/^#\s*/, "");
  const problems = [];
  let related = false;
  for (const match of content.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<a href="https:\/\/leetcode\.cn\/problems\/([A-Za-z0-9-]+)\/?(?:description\/?)?"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (match[1]) {
      related = /相关题目/.test(decode(match[2]));
      continue;
    }
    const cnSlug = match[3];
    const existing = problems.find((problem) => problem.cnSlug === cnSlug);
    const level = related ? "stretch" : "core";
    if (existing) {
      if (level === "core") existing.level = "core";
      continue;
    }
    problems.push({ cnSlug, level, text: decode(match[4]) });
  }
  return { title, problems };
}

/**
 * An article that links no problem but is named after one (`0207-course-schedule`):
 * that problem, its number checked against leetcode.com on import.
 */
function fromFileName(stem) {
  const match = stem.match(/^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  return match ? [{ cnSlug: match[2], level: "core", frontendId: String(Number(match[1])) }] : [];
}

/**
 * Items in list order from parsed articles (`[{ stem, title, problems }]`):
 * a problem once per list, core links before stretch ones. An article that
 * links problems must be in the config's `articles`: mapped to a section, or
 * to null to skip it.
 */
export function collectItems(articles, config) {
  const unmapped = articles.filter((article) => article.problems.length && config.articles[article.stem] === undefined).map((article) => article.stem);
  if (unmapped.length) throw new Error(`The config does not map these articles (run --init to see them all): ${unmapped.join(", ")}`);
  // An article mapped to null (a weekly recap) is skipped, its links too.
  const mapped = articles
    .filter((article) => config.articles[article.stem])
    .map((article) => ({ ...article, sectionId: config.articles[article.stem], problems: article.problems.length ? article.problems : fromFileName(article.stem) }));
  const core = new Set(mapped.flatMap((article) => article.problems.filter((problem) => problem.level === "core").map((problem) => problem.cnSlug)));
  const seen = new Set();
  const items = [];
  const noProblem = [];
  for (const { stem, title, sectionId, problems } of mapped) {
    if (!config.sections[sectionId]) throw new Error(`Article ${stem} maps to ${sectionId}, which has no section in the config.`);
    if (!problems.length) noProblem.push({ stem, title, sectionId });
    for (const problem of problems) {
      if (problem.level === "stretch" && core.has(problem.cnSlug)) continue;
      if (seen.has(problem.cnSlug)) continue;
      seen.add(problem.cnSlug);
      items.push({ cnSlug: problem.cnSlug, sectionId, chapterId: sectionId.split(".")[0], level: problem.level, stem, frontendId: problem.frontendId ?? null });
    }
  }
  return { items, noProblem };
}

function parseArgs(argv) {
  const args = { config: null, init: null, cache: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cache") args.cache = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--init") args.init = { url: argv[++i], id: argv[++i] };
    else if (!args.config) args.config = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.config && !args.init) {
    throw new Error("Usage: study-list-import-carl.mjs <config.json> [--cache dir] [--out file]\n       study-list-import-carl.mjs --init <topic-url> <list-id> [--cache dir]");
  }
  return args;
}

async function fetchPage(url, cache) {
  const file = cache ? path.join(cache, `${new URL(url).pathname.replace(/\.html$/, "").replace(/[^a-z0-9.-]+/gi, "_")}.html`) : null;
  if (file) {
    const cached = await readFile(file, "utf8").catch(() => null);
    if (cached) return cached;
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const html = await response.text();
      if (file) {
        await mkdir(cache, { recursive: true });
        await writeFile(file, html);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      return html;
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
}

async function loadTopic(sourceUrl, cache) {
  const topic = parseTopicPage(await fetchPage(sourceUrl, cache));
  const articles = [];
  for (const article of topic) {
    const parsed = parseArticle(await fetchPage(`${ORIGIN}${article.path}`, cache));
    articles.push({ ...article, title: parsed.title || article.title, problems: parsed.problems });
  }
  return articles;
}

async function init(args) {
  const out = path.join("scripts/study-lists", `${args.init.id}.json`);
  if (await access(out).then(() => true, () => false)) throw new Error(`${out} exists; edit it instead.`);
  const articles = await loadTopic(args.init.url, args.cache);
  const articleMap = {};
  const sections = {};
  articles.forEach((article, index) => {
    const id = `1.${index + 1}`;
    articleMap[article.stem] = id;
    sections[id] = { en: "", zh: article.title, pattern: "" };
    console.log(`${id} ${article.stem}: ${article.problems.length} problems (${article.problems.map((problem) => problem.cnSlug).join(", ")})`);
  });
  const config = {
    id: args.init.id,
    source: "programmercarl",
    name: { en: "", zh: "" },
    author: "代码随想录",
    sourceUrl: args.init.url,
    chapters: { 1: { en: "", zh: "" } },
    articles: articleMap,
    sections,
  };
  await writeFile(out, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${out}: ${articles.length} articles. Group them into sections, then fill in every English label and pattern.`);
}

function requireLabels(label, value, { pattern = false } = {}) {
  if (!value?.en || !value?.zh || (pattern && !value.pattern)) throw new Error(`${label} needs English and Chinese titles${pattern ? " and a pattern" : ""} in the config.`);
  if (CJK.test(value.en)) throw new Error(`${label}: the English title has Chinese characters: ${value.en}`);
}

async function importList(args) {
  const config = JSON.parse(await readFile(args.config, "utf8"));
  if (config.source !== "programmercarl") throw new Error(`${args.config} is not a programmercarl config; use study-list-import.mjs.`);
  requireLabels("The list name", config.name);
  const articles = await loadTopic(config.sourceUrl, args.cache);
  const { items, noProblem } = collectItems(articles, config);

  const slugs = items.map((item) => item.cnSlug);
  const [metadata, zh] = await Promise.all([
    readMetadata("leetcode.com", slugs, "questionFrontendId title titleSlug difficulty isPaidOnly"),
    readMetadata("leetcode.cn", slugs, "questionFrontendId titleSlug translatedTitle"),
  ]);
  const kept = [];
  const excluded = noProblem.map((article) => ({ sourceId: article.stem.slice(0, 32), title: article.title, sectionId: article.sectionId, reason: /^(offer|interview)-/.test(article.stem) ? "leetcode_cn_only" : "not_on_leetcode" }));
  const problems = [];
  for (const item of items) {
    const question = metadata.get(item.cnSlug);
    const cn = zh.get(item.cnSlug);
    if (!question || question.titleSlug !== item.cnSlug) {
      if (!cn) problems.push(`${item.cnSlug} (${item.stem}): found on neither site`);
      else excluded.push({ sourceId: cn.questionFrontendId.slice(0, 32), title: cn.translatedTitle, sectionId: item.sectionId, reason: "leetcode_cn_only" });
      continue;
    }
    if (item.frontendId && question.questionFrontendId !== item.frontendId) problems.push(`${item.cnSlug}: the file name says ${item.frontendId}, leetcode.com says ${question.questionFrontendId}`);
    if (!["Easy", "Medium", "Hard"].includes(question.difficulty)) problems.push(`${item.cnSlug}: difficulty ${question.difficulty}`);
    if (typeof question.isPaidOnly !== "boolean") problems.push(`${item.cnSlug}: no paid flag`);
    if (CJK.test(question.title)) problems.push(`${item.cnSlug}: the leetcode.com title has Chinese characters`);
    kept.push({ ...item, question, zhTitle: cn?.translatedTitle || question.title });
  }
  if (problems.length) throw new Error(`Metadata check failed:\n  ${problems.join("\n  ")}`);

  const usedSections = [...new Set(kept.map((item) => item.sectionId))];
  const usedChapters = [...new Set(kept.map((item) => item.chapterId))];
  const output = {
    id: config.id,
    name: config.name,
    author: config.author,
    sourceUrl: config.sourceUrl,
    sourceUpdatedAt: null,
    generatedAt: new Date().toISOString(),
    metadataSite: "leetcode.com",
    chapters: usedChapters.map((id) => {
      requireLabels(`Chapter ${id}`, config.chapters[id]);
      return { id, title: { en: config.chapters[id].en, zh: config.chapters[id].zh } };
    }),
    sections: usedSections.map((id) => {
      const section = config.sections[id];
      requireLabels(`Section ${id}`, section, { pattern: true });
      return { id, chapterId: id.split(".")[0], title: { en: section.en, zh: section.zh }, pattern: section.pattern, optional: false };
    }),
    items: kept.map((item) => ({
      slug: item.cnSlug,
      frontendId: item.question.questionFrontendId,
      title: { en: item.question.title, zh: item.zhTitle },
      difficulty: item.question.difficulty,
      paidOnly: item.question.isPaidOnly,
      rating: null,
      sectionId: item.sectionId,
      level: item.level,
    })),
    excluded,
  };

  const out = args.out ?? path.join("apps/web/src/server/study-lists/builtin", `${config.id}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(output, null, 2)}\n`);
  const stretch = output.items.filter((item) => item.level === "stretch").length;
  console.log(`${out}: ${output.items.length} items (${stretch} stretch), ${output.items.filter((item) => item.paidOnly).length} paid, ${excluded.length} excluded.`);
  for (const entry of excluded) console.log(`  excluded ${entry.sourceId} (${entry.reason})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  (args.init ? init(args) : importList(args)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
