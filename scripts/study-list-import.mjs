#!/usr/bin/env node
/*
 * Built-in study list importer (read-only against LeetCode).
 *
 * Builds apps/web/src/server/study-lists/builtin/<id>.json from a public
 * problem list post on leetcode.cn and a hand-written config in
 * scripts/study-lists/<id>.json (English labels, section -> pattern map).
 *
 * Kept from the post: the order of problems, their sections, the optional
 * (选做) and stretch (思维扩展, 进阶) markers, and contest ratings. Nothing
 * else of the post's text is copied. Problem metadata (English title,
 * difficulty, paid flag, frontend id) is read from leetcode.com's GraphQL API
 * and the Chinese title from leetcode.cn's, so nothing in the output is
 * written by hand or by a model.
 *
 * Sections: `§x.y` headings, chapter headings (`一、`), and any other heading
 * the config's `headings` maps to a section id. Other `##` headings end the
 * current section; deeper unnumbered headings (答疑, Part A) stay in it.
 * Problems inside fenced code blocks are ignored.
 *
 * leetcode.cn-only problems (LCP, LCR, 面试题) are replaced by a leetcode.com
 * problem only when the post says they are the same (同 X 题) or the config's
 * `replacements` names one; otherwise they are listed under `excluded`. A
 * replacement already listed in the same section is not repeated.
 *
 * Usage:
 *   node scripts/study-list-import.mjs <config.json> [--metadata-site leetcode.com|leetcode.cn]
 *     [--input post.html] [--out file]
 *   node scripts/study-list-import.mjs --init <source-url> <list-id> [--input post.html]
 *     writes scripts/study-lists/<list-id>.json with every section the post
 *     has, Chinese titles filled in; add English titles and patterns by hand.
 *
 * --metadata-site defaults to leetcode.com; leetcode.cn returns the same
 * English titles (for environments that cannot reach leetcode.com; the output
 * records which site was read). Then run `pnpm vitest run apps/web/src/server/study-lists`.
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

const USER_AGENT = "Mozilla/5.0 (ankileet study-list importer)";
const BATCH = 25;
const DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const DEFAULT_STOP = ["关联题单", "算法题单", "思考"];
const DEFAULT_STRETCH = ["思维扩展", "进阶"];

/** 零..九十九 as a number (十 = 10, 十五 = 15, 二十 = 20); null if not a numeral. */
export function chineseNumeral(text) {
  if (!/^[零一二三四五六七八九十]+$/.test(text)) return null;
  if (!text.includes("十")) return text.length === 1 ? DIGITS[text] : null;
  const [tens, ones] = text.split("十");
  if (tens.length > 1 || ones.length > 1) return null;
  return (tens ? DIGITS[tens] : 1) * 10 + (ones ? DIGITS[ones] : 0);
}

function parseArgs(argv) {
  const args = { config: null, init: null, metadataSite: "leetcode.com", input: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--metadata-site") args.metadataSite = argv[++i];
    else if (arg === "--input") args.input = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--init") args.init = { url: argv[++i], id: argv[++i] };
    else if (!args.config) args.config = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.config && !args.init) {
    throw new Error("Usage: study-list-import.mjs <config.json> [--metadata-site leetcode.com|leetcode.cn] [--input post.html] [--out file]\n       study-list-import.mjs --init <source-url> <list-id>");
  }
  if (args.metadataSite !== "leetcode.com" && args.metadataSite !== "leetcode.cn") {
    throw new Error(`--metadata-site must be leetcode.com or leetcode.cn, not ${args.metadataSite}`);
  }
  return args;
}

async function loadPost(sourceUrl, input) {
  const html = input
    ? await readFile(input, "utf8")
    : await fetch(sourceUrl, { headers: { "user-agent": USER_AGENT } }).then((response) => {
        if (!response.ok) throw new Error(`${sourceUrl}: HTTP ${response.status}`);
        return response.text();
      });
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("The post page has no __NEXT_DATA__ block; its layout changed.");
  const queries = JSON.parse(match[1])?.props?.pageProps?.dehydratedState?.queries ?? [];
  const post = queries.map((query) => query?.state?.data?.qaQuestion).find((q) => typeof q?.content === "string");
  if (!post) throw new Error("The post's content was not found in the page data.");
  return { content: post.content, title: post.title ?? "", updatedAt: post.updatedAt ?? null };
}

/** The section a heading opens: `{ id, chapter, level }`, `"stop"`, `"keep"`, or null (no section). */
function classifyHeading(level, text, config) {
  const stops = config.stopAtHeadings ?? DEFAULT_STOP;
  if (level <= 2 && stops.some((stop) => text.startsWith(stop))) return "stop";
  const mapped = config.headings?.[text];
  if (mapped) return { id: mapped, chapter: mapped.split(".")[0] };
  const numbered = text.match(/^§(\d+(?:\.\d+)*)\s/);
  if (numbered) return { id: numbered[1], chapter: numbered[1].split(".")[0] };
  const chapter = text.match(/^([零一二三四五六七八九十]+)、/);
  const number = chapter ? chineseNumeral(chapter[1]) : null;
  if (number != null) return { id: String(number), chapter: String(number) };
  return level <= 2 ? null : "keep";
}

/** Heading text without the section number and the optional marker. */
function headingTitle(text) {
  return text
    .replace(/^§\d+(?:\.\d+)*\s+/, "")
    .replace(/^[零一二三四五六七八九十]+、/, "")
    .replace(/[（(]选做[）)]/g, "")
    .trim();
}

const problemLink =
  /^[-*] \[(?<id>[^\]]*?)\. (?<title>[^\]]+)\]\(https:\/\/leetcode\.cn\/problems\/(?<slug>[A-Za-z0-9-]+)(?:\/(?:description|solutions?)(?:\/[^)\s]*)?)?\/?\)(?<rest>.*)$/;

/**
 * Walks the post: headings (outside code blocks) with the problems under
 * each. `onHeading` sees every section-opening heading; returns the problem
 * items in post order.
 */
function walkPost(content, config, onHeading = () => {}) {
  const items = [];
  const stretchLabels = config.stretchLabels ?? DEFAULT_STRETCH;
  let section = null;
  let stretch = false;
  let fenced = false;
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const text = heading[2].trim();
      const opened = classifyHeading(heading[1].length, text, config);
      stretch = false;
      if (opened === "stop") break;
      if (opened === "keep") continue;
      section = opened;
      if (opened) onHeading({ ...opened, text, line: index + 1 });
      continue;
    }
    const label = line.match(/^\*\*([^*]+)\*\*/);
    if (label) {
      stretch = stretchLabels.some((name) => label[1].trim().startsWith(name));
      continue;
    }
    if (!/^[-*] \[/.test(line) || !line.includes("leetcode.cn/problems/")) continue;
    const item = line.match(problemLink);
    if (!item) {
      // A bullet linking a write-up (no "<id>. <title>"), not a problem.
      if (/leetcode\.cn\/problems\/[^/)\s]+\/solutions?\//.test(line) && !/^[-*] \[[^\]]*?\. /.test(line)) continue;
      throw new Error(`Line ${index + 1}: a problem link in an unexpected format: ${line.slice(0, 120)}`);
    }
    items.push({ item, section, stretch, line: index + 1 });
  }
  return items;
}

/** Problem items in post order, with section, level, rating, and replacement hint. */
export function parsePost(content, config) {
  const optionalSections = new Set();
  const walked = walkPost(content, config, (heading) => {
    if (/选做/.test(heading.text)) optionalSections.add(heading.id);
  });
  const unmapped = [...new Set(walked.filter(({ section }) => !section || !config.sections[section.id]).map(({ section, line }) => section?.id ?? `(no section, line ${line})`))];
  if (unmapped.length) {
    throw new Error(`The config does not map these sections (run --init to see them all): ${unmapped.join(", ")}`);
  }
  return walked.map(({ item, section, stretch, line }) => {
    const rest = item.groups.rest;
    const rating = rest.match(/^\s*(\d{3,4})(?!\d)/);
    const same = rest.match(/同\s*(\d+)\s*题/);
    const sectionConfig = config.sections[section.id];
    const optional = sectionConfig.optional ?? optionalSections.has(section.id);
    return {
      sourceId: item.groups.id.trim(),
      zhTitle: item.groups.title.trim(),
      cnSlug: item.groups.slug,
      sectionId: section.id,
      chapterId: section.chapter,
      sectionOptional: optional,
      level: stretch ? "stretch" : optional ? "optional" : "core",
      rating: rating ? Number(rating[1]) : null,
      sameAs: same ? same[1] : null,
      line,
    };
  });
}

/** Every section the post opens, in order, with its problem count (for --init). */
export function outlinePost(content, config) {
  const sections = new Map();
  const walked = walkPost(content, config, (heading) => {
    if (!sections.has(heading.id)) {
      sections.set(heading.id, { id: heading.id, chapter: heading.chapter, title: headingTitle(heading.text), optional: /选做/.test(heading.text), problems: 0 });
    }
  });
  for (const { section } of walked) if (section) sections.get(section.id).problems += 1;
  return [...sections.values()];
}

/**
 * Splits parsed items into kept items (leetcode.com slugs) and exclusions.
 * `lookup(frontendId)` resolves a twin the list itself does not contain.
 */
export async function resolveSiteOnly(parsed, config, lookup = async () => null) {
  const kept = [];
  const excluded = [];
  const byId = new Map(parsed.filter((item) => /^\d+$/.test(item.sourceId)).map((item) => [item.sourceId, item]));
  for (const item of parsed) {
    if (/^\d+$/.test(item.sourceId)) {
      // A section can list a problem twice (a second technique); keep the first.
      if (!kept.some((other) => other.slug === item.cnSlug && other.sectionId === item.sectionId)) {
        kept.push({ ...item, slug: item.cnSlug, frontendId: item.sourceId });
      }
      continue;
    }
    const twin = item.sameAs ? byId.get(item.sameAs) : null;
    const slug = config.replacements?.[item.sourceId] ?? twin?.cnSlug ?? (item.sameAs ? await lookup(item.sameAs) : null);
    if (item.sameAs && !slug) {
      throw new Error(`Line ${item.line}: ${item.sourceId} is the same as ${item.sameAs}, which was not found; add it to the config's replacements.`);
    }
    if (!slug) {
      excluded.push({ sourceId: item.sourceId, title: item.zhTitle, sectionId: item.sectionId, reason: "leetcode_cn_only" });
      continue;
    }
    excluded.push({ sourceId: item.sourceId, title: item.zhTitle, sectionId: item.sectionId, reason: "same_as", replacedBy: slug });
    if (!kept.some((other) => other.slug === slug && other.sectionId === item.sectionId)) {
      kept.push({ ...item, slug, frontendId: item.sameAs ?? twin?.sourceId ?? null });
    }
  }
  return { kept, excluded };
}

async function graphql(site, query, variables = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`https://${site}/graphql/`, {
      method: "POST",
      headers: { "content-type": "application/json", referer: `https://${site}/problemset/`, "user-agent": USER_AGENT },
      body: JSON.stringify({ query, variables }),
    });
    const json = await response.json().catch(() => null);
    if (response.ok && json?.data) return json.data;
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${site} GraphQL: HTTP ${response.status} ${JSON.stringify(json?.errors ?? null).slice(0, 300)}`);
  }
}

export async function readMetadata(site, slugs, fields) {
  const metadata = new Map();
  for (let start = 0; start < slugs.length; start += BATCH) {
    const batch = slugs.slice(start, start + BATCH);
    const query = batch.map((slug, i) => `q${i}: question(titleSlug: ${JSON.stringify(slug)}) { ${fields} }`).join("\n");
    const data = await graphql(site, `query ankileetStudyList {\n${query}\n}`);
    batch.forEach((slug, i) => metadata.set(slug, data[`q${i}`] ?? null));
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return metadata;
}

/** The slug of the problem with this frontend id on leetcode.com, or null. */
async function slugForFrontendId(frontendId) {
  const data = await graphql(
    "leetcode.com",
    `query ankileetLookup($filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(categorySlug: "", limit: 10, skip: 0, filters: $filters) {
        data { questionFrontendId titleSlug }
      }
    }`,
    { filters: { searchKeywords: frontendId } },
  );
  return data.problemsetQuestionList?.data?.find((question) => question.questionFrontendId === frontendId)?.titleSlug ?? null;
}

async function init(args) {
  const out = path.join("scripts/study-lists", `${args.init.id}.json`);
  if (await access(out).then(() => true, () => false)) throw new Error(`${out} exists; edit it instead.`);
  const post = await loadPost(args.init.url, args.input);
  const outline = outlinePost(post.content, {});
  const chapters = {};
  const sections = {};
  for (const section of outline) {
    if (section.id === section.chapter) chapters[section.chapter] ??= { en: "", zh: section.title };
    else chapters[section.chapter] ??= { en: "", zh: "" };
    if (section.problems === 0) continue;
    sections[section.id] = { en: "", zh: section.title, pattern: "", ...(section.optional ? { optional: true } : {}) };
  }
  const config = {
    id: args.init.id,
    name: { en: "", zh: "" },
    author: "",
    sourceUrl: args.init.url,
    headings: {},
    chapters,
    sections,
  };
  await writeFile(out, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`${out}: ${Object.keys(sections).length} sections with problems (post: ${post.title}).`);
  console.log("Fill in name, author, every English title, and each section's pattern; map unnumbered headings in `headings`.");
}

async function importList(args) {
  const config = JSON.parse(await readFile(args.config, "utf8"));
  if (config.source === "programmercarl") throw new Error(`${args.config} is a programmercarl.com config; use study-list-import-carl.mjs.`);
  const post = await loadPost(config.sourceUrl, args.input);
  const parsed = parsePost(post.content, config);
  const { kept, excluded } = await resolveSiteOnly(parsed, config, slugForFrontendId);

  const slugs = [...new Set(kept.map((item) => item.slug))];
  const [metadata, zh] = await Promise.all([
    readMetadata(args.metadataSite, slugs, "questionFrontendId title titleSlug difficulty isPaidOnly"),
    readMetadata("leetcode.cn", slugs, "titleSlug translatedTitle"),
  ]);
  const problems = [];
  for (const slug of slugs) {
    const question = metadata.get(slug);
    if (!question || question.titleSlug !== slug) problems.push(`${slug}: not found on ${args.metadataSite}`);
    else if (!["Easy", "Medium", "Hard"].includes(question.difficulty)) problems.push(`${slug}: difficulty ${question.difficulty}`);
    else if (typeof question.isPaidOnly !== "boolean") problems.push(`${slug}: no paid flag`);
  }
  for (const item of kept) {
    const question = metadata.get(item.slug);
    if (question && item.frontendId && question.questionFrontendId !== item.frontendId) {
      problems.push(`${item.slug}: the post says ${item.frontendId}, ${args.metadataSite} says ${question.questionFrontendId}`);
    }
  }
  if (problems.length) throw new Error(`Metadata check failed:\n  ${[...new Set(problems)].join("\n  ")}`);

  // Post order, not config key order: integer-like keys ("5") sort first in JS.
  const usedSections = [...new Set(kept.map((item) => item.sectionId))];
  const usedChapters = [...new Set(kept.map((item) => item.chapterId))];
  const optionalSections = new Set(parsed.filter((item) => item.sectionOptional).map((item) => item.sectionId));
  const output = {
    id: config.id,
    name: config.name,
    author: config.author,
    sourceUrl: config.sourceUrl,
    sourceUpdatedAt: post.updatedAt,
    generatedAt: new Date().toISOString(),
    metadataSite: args.metadataSite,
    chapters: usedChapters.map((id) => {
      const title = config.chapters[id];
      if (!title?.en || !title?.zh) throw new Error(`Chapter ${id} needs English and Chinese titles in the config.`);
      return { id, title: { en: title.en, zh: title.zh } };
    }),
    sections: usedSections.map((id) => {
      const section = config.sections[id];
      if (!section.en || !section.zh || !section.pattern) throw new Error(`Section ${id} needs English and Chinese titles and a pattern.`);
      return { id, chapterId: id.split(".")[0], title: { en: section.en, zh: section.zh }, pattern: section.pattern, optional: optionalSections.has(id) };
    }),
    items: kept.map((item) => {
      const question = metadata.get(item.slug);
      return {
        slug: item.slug,
        frontendId: question.questionFrontendId,
        title: { en: question.title, zh: zh.get(item.slug)?.translatedTitle || item.zhTitle },
        difficulty: question.difficulty,
        paidOnly: question.isPaidOnly,
        rating: item.rating,
        sectionId: item.sectionId,
        level: item.level,
      };
    }),
    excluded,
  };

  const out = args.out ?? path.join("apps/web/src/server/study-lists/builtin", `${config.id}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(output, null, 2)}\n`);
  const levels = output.items.reduce((acc, item) => ({ ...acc, [item.level]: (acc[item.level] ?? 0) + 1 }), {});
  console.log(
    `${out}: ${output.items.length} items (${slugs.length} unique problems; ${JSON.stringify(levels)}), ` +
      `${output.items.filter((item) => item.paidOnly).length} paid, ${excluded.length} excluded, metadata from ${args.metadataSite}.`,
  );
  for (const entry of excluded) {
    console.log(`  excluded ${entry.sourceId} (${entry.reason}${entry.replacedBy ? ` -> ${entry.replacedBy}` : ""})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  (args.init ? init(args) : importList(args)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
