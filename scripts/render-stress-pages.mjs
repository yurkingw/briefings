import fs from "node:fs";
import path from "node:path";
import nunjucks from "nunjucks";
import { excerpt } from "../lib/excerpt.js";
import {
  defaultWave,
  detailCards,
  displayTitle,
  displayWave,
  finalJudgments,
  financeLead,
  githubSummary,
  hasWaveSplit,
  hotFromItems,
  itemKicker,
  linkViews,
  pagePropertyRows,
  paperFields,
  paperLinkList,
  papersWindow,
  remainderNews,
  saSteps,
  takeFeatured,
  takeRest,
  waveItems,
} from "../lib/pages-parity.js";
import { absoluteUrl, site } from "../lib/site.js";
import { labels, textLang } from "../lib/ui-labels.js";
import { SYNTHETIC_LONG_TITLE, syntheticTitleStats } from "../test/fixtures/long-title.mjs";

export function assertStressTitle(title = SYNTHETIC_LONG_TITLE) {
  const stats = syntheticTitleStats(title);
  if (stats.cjkCount < 60 || stats.latinRun < 120 || !stats.hasPunctuation || stats.hasPlaceholder) {
    throw new Error(`stress title failed before render: ${JSON.stringify(stats)}`);
  }
  return stats;
}

function item(id, lane) {
  return {
    id,
    domain: "Test data",
    angle: "other",
    title: SYNTHETIC_LONG_TITLE,
    detail: true,
    wave: "晨间",
    background: "Test data background.",
    facts: "Test data facts.",
    why: "Test data why.",
    arch_impact: "Test data impact.",
    channel: "Test data",
    first_source_at: "Test data",
    finsec: false,
    hard_gate: false,
    links: ["https://example.com/stress"],
    lane,
  };
}

function briefing(kind) {
  const daily = kind === "daily";
  return {
    schema: daily ? "qianji.briefing.daily.v1" : "qianji.briefing.weekly.v1",
    date: daily ? "2099-01-01" : undefined,
    week: daily ? undefined : "2099-W01",
    timezone: "Asia/Shanghai",
    updated_at: "2099-01-01T00:00:00+08:00",
    wave: "晨间",
    summary: "Test data. Synthetic fixture. Not production content.",
    sample: true,
    sample_note: "Test data. Not a published briefing.",
    metrics: { news: 1, polfin: 1, finsec: 0, papers: 0, gh_rising: 0, gh_newcomers: 0, home_related: "0/0" },
    news: [item(daily ? "stress-daily-news" : "stress-weekly-news", "news")],
    polfin: [item(daily ? "stress-daily-polfin" : "stress-weekly-polfin", "polfin")],
    papers: [],
    decisions: [],
    sources: [],
    github: { rising: [], newcomers: [] },
  };
}

function environment(root) {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, "src/_includes")), {
    autoescape: true,
  });
  const filters = {
    excerpt,
    absoluteUrl,
    displayTitle,
    displayWave,
    textLang,
    itemKicker,
    waveItems,
    hasWaveSplit,
    defaultWave,
    detailCards,
    remainderNews,
    hotFromItems,
    takeFeatured,
    takeRest,
    pagePropertyRows,
    papersWindow,
    paperFields,
    paperLinkList,
    linkViews,
    githubSummary,
    saSteps,
    finalJudgments,
    financeLead,
  };
  for (const [name, fn] of Object.entries(filters)) env.addFilter(name, fn);
  return env;
}

export function renderStressPages(outDir, root = path.resolve(import.meta.dirname, "..")) {
  const stats = assertStressTitle();
  fs.mkdirSync(outDir, { recursive: true });
  const env = environment(root);
  const pages = {};
  for (const kind of ["daily", "weekly"]) {
    const data = briefing(kind);
    const inner = env.render("briefing.njk", { briefing: data, labels, site, page: { url: `/${kind}/stress/` } });
    const html = env.render("base.njk", {
      briefing: data,
      labels,
      site,
      content: inner,
      page: { url: `/${kind}/stress/` },
    });
    if (!html.includes(SYNTHETIC_LONG_TITLE) || html.includes("${")) {
      throw new Error(`${kind} stress page did not receive the expanded title`);
    }
    const file = path.join(outDir, `stress-${kind}.html`);
    fs.writeFileSync(file, html);
    pages[kind] = file;
  }
  return { stats, pages, title: SYNTHETIC_LONG_TITLE };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || path.join("/tmp", "brf-stress");
  const result = renderStressPages(out);
  console.log(JSON.stringify({ ...result.stats, pages: result.pages }, null, 2));
}
