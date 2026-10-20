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
 * difficulty, paid flag, frontend id) is read from LeetCode's GraphQL API, so
 * nothing in the output is written by hand or by a model.
 *
 * leetcode.cn-only problems (LCP, LCR, 面试题) are replaced by a leetcode.com
 * problem only when the post says they are the same (同 X 题) or the config's
 * `replacements` names one; otherwise they are listed under `excluded`. A
 * replacement already listed in the same section is not repeated.
 *
 * Usage:
 *   node scripts/study-list-import.mjs scripts/study-lists/<id>.json \
 *     [--metadata-site leetcode.com|leetcode.cn] [--input post.html] [--out file]
 *
 * --metadata-site defaults to leetcode.com. leetcode.cn's API returns the same
 * English titles; use it only where leetcode.com is unreachable, and rerun with
 * leetcode.com before launch (the output records which site was read).
 * Then run `pnpm vitest run apps/web/src/server/study-lists`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const USER_AGENT = "Mozilla/5.0 (ankileet study-list importer)";
const BATCH = 25;
const NUMERALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseArgs(argv) {
  const args = { config: null, metadataSite: "leetcode.com", input: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--metadata-site") args.metadataSite = argv[++i];
    else if (arg === "--input") args.input = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (!args.config) args.config = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.config) throw new Error("Usage: study-list-import.mjs <config.json> [--metadata-site leetcode.com|leetcode.cn] [--input post.html] [--out file]");
  if (args.metadataSite !== "leetcode.com" && args.metadataSite !== "leetcode.cn") {
    throw new Error(`--metadata-site must be leetcode.com or leetcode.cn, not ${args.metadataSite}`);
  }
  return args;
}

async function loadPost(config, input) {
  const html = input
    ? await readFile(input, "utf8")
    : await fetch(config.sourceUrl, { headers: { "user-agent": USER_AGENT } }).then((response) => {
        if (!response.ok) throw new Error(`${config.sourceUrl}: HTTP ${response.status}`);
        return response.text();
      });
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("The post page has no __NEXT_DATA__ block; its layout changed.");
  const queries = JSON.parse(match[1])?.props?.pageProps?.dehydratedState?.queries ?? [];
  const post = queries.map((query) => query?.state?.data?.qaQuestion).find((q) => typeof q?.content === "string");
  if (!post) throw new Error("The post's content was not found in the page data.");
  return { content: post.content, updatedAt: post.updatedAt ?? null };
}

/** Problem items in post order, with section, level, rating, and replacement hint. */
export function parsePost(content, config) {
  const items = [];
  let chapter = null;
  let section = null;
  let stretch = false;
  const problemLine =
    /^[-*] \[(?<id>[^\]]*?)\. (?<title>[^\]]+)\]\(https:\/\/leetcode\.cn\/problems\/(?<slug>[A-Za-z0-9-]+)(?:\/description)?\/?\)(?<rest>.*)$/;

  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{2,6})\s+(.*)$/);
    if (heading) {
      const text = heading[2].trim();
      stretch = false;
      if (text.startsWith(config.stopAtHeading)) break;
      const numbered = text.match(/^§(\d+(?:\.\d+)*)\s/);
      const chapterMatch = text.match(/^([一二三四五六七八九十]+)、/);
      if (numbered) {
        section = numbered[1];
        chapter = section.split(".")[0];
      } else if (chapterMatch) {
        chapter = String(NUMERALS[chapterMatch[1]] ?? "");
        section = chapter;
      } else {
        section = null;
      }
      continue;
    }
    const label = line.match(/^\*\*([^*]+)\*\*/);
    if (label) {
      stretch = config.stretchLabels.some((name) => label[1].trim().startsWith(name));
      continue;
    }
    if (!/^[-*] \[/.test(line) || !line.includes("leetcode.cn/problems/")) continue;
    const item = line.match(problemLine);
    if (!item) throw new Error(`Line ${index + 1}: a problem link in an unexpected format: ${line.slice(0, 120)}`);
    if (!section || !config.sections[section]) {
      throw new Error(`Line ${index + 1}: problem ${item.groups.id} is under section "${section}", which the config does not map.`);
    }
    const rest = item.groups.rest;
    const rating = rest.match(/^\s*(\d{3,4})(?!\d)/);
    const same = rest.match(/同\s*(\d+)\s*题/);
    items.push({
      sourceId: item.groups.id.trim(),
      zhTitle: item.groups.title.trim(),
      cnSlug: item.groups.slug,
      sectionId: section,
      chapterId: chapter,
      level: stretch ? "stretch" : config.sections[section].optional ? "optional" : "core",
      rating: rating ? Number(rating[1]) : null,
      sameAs: same ? same[1] : null,
      line: index + 1,
    });
  }
  return items;
}

/** Splits parsed items into kept items (leetcode.com slugs) and exclusions. */
export function resolveSiteOnly(parsed, config) {
  const kept = [];
  const excluded = [];
  const byId = new Map(parsed.filter((item) => /^\d+$/.test(item.sourceId)).map((item) => [item.sourceId, item]));
  for (const item of parsed) {
    if (/^\d+$/.test(item.sourceId)) {
      kept.push({ ...item, slug: item.cnSlug, frontendId: item.sourceId });
      continue;
    }
    const replacementSlug = config.replacements?.[item.sourceId];
    const twin = item.sameAs ? byId.get(item.sameAs) : null;
    if (item.sameAs && !twin && !replacementSlug) {
      throw new Error(`Line ${item.line}: ${item.sourceId} is the same as ${item.sameAs}, which the list does not contain; add it to the config's replacements.`);
    }
    const slug = replacementSlug ?? twin?.cnSlug ?? null;
    if (!slug) {
      excluded.push({ sourceId: item.sourceId, title: item.zhTitle, sectionId: item.sectionId, reason: "leetcode_cn_only" });
      continue;
    }
    const alreadyInSection = kept.some((other) => other.slug === slug && other.sectionId === item.sectionId);
    excluded.push({ sourceId: item.sourceId, title: item.zhTitle, sectionId: item.sectionId, reason: "same_as", replacedBy: slug });
    if (!alreadyInSection) {
      kept.push({ ...item, slug, frontendId: twin?.sourceId ?? null, zhTitle: twin?.zhTitle ?? item.zhTitle });
    }
  }
  return { kept, excluded };
}

async function graphql(site, query) {
  const response = await fetch(`https://${site}/graphql/`, {
    method: "POST",
    headers: { "content-type": "application/json", referer: `https://${site}/problemset/`, "user-agent": USER_AGENT },
    body: JSON.stringify({ query }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.data) {
    throw new Error(`${site} GraphQL: HTTP ${response.status} ${JSON.stringify(json?.errors ?? null).slice(0, 300)}`);
  }
  return json.data;
}

async function readMetadata(site, slugs) {
  const metadata = new Map();
  for (let start = 0; start < slugs.length; start += BATCH) {
    const batch = slugs.slice(start, start + BATCH);
    const fields = batch
      .map((slug, i) => `q${i}: question(titleSlug: ${JSON.stringify(slug)}) { questionFrontendId title titleSlug difficulty isPaidOnly }`)
      .join("\n");
    const data = await graphql(site, `query ankileetStudyList {\n${fields}\n}`);
    batch.forEach((slug, i) => metadata.set(slug, data[`q${i}`] ?? null));
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return metadata;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(args.config, "utf8"));
  const post = await loadPost(config, args.input);
  const parsed = parsePost(post.content, config);
  const { kept, excluded } = resolveSiteOnly(parsed, config);

  const slugs = [...new Set(kept.map((item) => item.slug))];
  const metadata = await readMetadata(args.metadataSite, slugs);
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
  const output = {
    id: config.id,
    name: config.name,
    author: config.author,
    sourceUrl: config.sourceUrl,
    sourceUpdatedAt: post.updatedAt,
    generatedAt: new Date().toISOString(),
    metadataSite: args.metadataSite,
    chapters: usedChapters.map((id) => {
      if (!config.chapters[id]) throw new Error(`Chapter ${id} has no title in the config.`);
      return { id, title: config.chapters[id] };
    }),
    sections: usedSections.map((id) => {
      const section = config.sections[id];
      return {
        id,
        chapterId: id.split(".")[0],
        title: { en: section.en, zh: section.zh },
        pattern: section.pattern,
        optional: Boolean(section.optional),
      };
    }),
    items: kept.map((item) => {
      const question = metadata.get(item.slug);
      return {
        slug: item.slug,
        frontendId: question.questionFrontendId,
        title: { en: question.title, zh: item.zhTitle },
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
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
