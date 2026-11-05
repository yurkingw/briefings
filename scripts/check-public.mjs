import fs from "node:fs";
import path from "node:path";
import { excerpt } from "../lib/excerpt.js";
import { FOLD_STEP, nextFoldCount } from "../src/js/fold.js";
import { loadBriefings } from "../lib/load-briefings.js";
import { isoWeekId, selectStage, shanghaiDate } from "../lib/stage.js";
import { selectHot, tocGroups, withNotes } from "../lib/pages-parity.js";
import { absoluteUrl } from "../lib/site.js";
import {
  annotateUnconfirmed,
  findForbidden,
  stripText,
} from "../lib/strip-public.js";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    fail(`missing ${rel}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function assertClean(rel, text) {
  const hits = findForbidden(text);
  if (hits.length) fail(`${rel} contains forbidden public text: ${hits.join(", ")}`);
}

const cases = [
  ["/", "https://yurkingw.github.io/briefings/"],
  ["/daily/2026-11-05/", "https://yurkingw.github.io/briefings/daily/2026-11-05/"],
  ["/briefings/weekly/2026-W45/", "https://yurkingw.github.io/briefings/weekly/2026-W45/"],
  ["/briefings/briefings/daily/2026-11-05/", "https://yurkingw.github.io/briefings/daily/2026-11-05/"],
];
for (const [input, expected] of cases) {
  const actual = absoluteUrl(input);
  if (actual !== expected) fail(`absoluteUrl(${input}) => ${actual}, expected ${expected}`);
}

const stripped = stripText(
  "canvas_id=abc /workspace/secret Home 12 页内未见强簇 约 133 万曝光 rising-enriched intraday-x.tsx",
);
if (findForbidden(stripped).length) fail(`stripText left forbidden text: ${stripped}`);
const marked = annotateUnconfirmed("约 $133M，不确认精确数字");
if (!/unconfirmed/i.test(marked)) fail("uncertain amount was not marked unconfirmed");
const stated = annotateUnconfirmed("API 成本约 $1,213,430");
if (/unconfirmed/i.test(stated)) fail("stated amount was marked unconfirmed");
const tableRow = annotateUnconfirmed("| 14 | 加密 | 约 $133M 不确定 | 是 |");
if (!tableRow.endsWith("|") || !tableRow.includes("（unconfirmed）|")) {
  fail(`table-row annotation escaped the cell: ${tableRow}`);
}

const dailyJson = JSON.parse(read("content/daily/2026-11-05.json"));
const weeklyJson = JSON.parse(read("content/weekly/2026-W45.json"));
if (dailyJson.schema !== "qianji.briefing.daily.v1") fail("daily schema missing");
if (weeklyJson.schema !== "qianji.briefing.weekly.v1") fail("weekly schema missing");
if (!Array.isArray(dailyJson.news) || dailyJson.news.length < 1) fail("daily news missing");
if (!Array.isArray(weeklyJson.decisions) || weeklyJson.decisions.length < 1) fail("weekly decisions missing");

for (const file of walk(path.join(root, "content"))) {
  if (!/\.(json|md)$/.test(file)) continue;
  assertClean(path.relative(root, file), fs.readFileSync(file, "utf8"));
}

const pages = {
  "home": "_site/index.html",
  "daily": "_site/daily/2026-11-05/index.html",
  "weekly": "_site/weekly/2026-W45/index.html",
};
const html = {};
for (const [name, rel] of Object.entries(pages)) html[name] = read(rel);

if (html.home && !html.home.includes("https://yurkingw.github.io/briefings/")) {
  fail("home canonical is missing the baseUrl");
}
if (html.home && !html.home.includes("/briefings/daily/2026-11-05/")) {
  fail("home is missing the daily pathPrefix link");
}
if (html.home && !html.home.includes("/briefings/weekly/2026-W45/")) {
  fail("home is missing the weekly pathPrefix link");
}
if (html.daily && !html.daily.includes("https://yurkingw.github.io/briefings/daily/2026-11-05/")) {
  fail("daily absolute URL is missing the baseUrl");
}
if (html.weekly && !html.weekly.includes("https://yurkingw.github.io/briefings/weekly/2026-W45/")) {
  fail("weekly absolute URL is missing the baseUrl");
}
for (const [name, text] of Object.entries(html)) {
  if (!text) continue;
  if (text.includes("/briefings/briefings/")) fail(`${name} doubled the pathPrefix`);
  if (!text.includes('href="/briefings/css/site.css"') && !text.includes("href='/briefings/css/site.css'")) {
    fail(`${name} stylesheet is not under the pathPrefix`);
  }
  assertClean(pages[name], text);
}

const css = path.join(root, "_site/css/site.css");
if (!fs.existsSync(css)) fail("missing _site/css/site.css");

if (html.daily) {
  for (const label of ["Conclusion", "News", "Papers", "Sources"]) {
    if (!html.daily.includes(label)) fail(`daily page missing English label ${label}`);
  }
  if (!html.daily.includes("午间")) fail("daily page dropped original-language body text");
  if ((html.daily.includes("$133") || html.daily.includes("€1.18") || html.daily.includes("1.33")) && !/unconfirmed/i.test(html.daily)) {
    fail("daily page states an unconfirmed amount without the unconfirmed marker");
  }
}
if (html.weekly) {
  for (const label of ["Conclusion", "Decisions", "News"]) {
    if (!html.weekly.includes(label)) fail(`weekly page missing English label ${label}`);
  }
  if (!/unconfirmed/i.test(html.weekly)) fail("weekly page missing unconfirmed amount marker");
}
if (html.home && !html.home.includes("No daily briefings yet.") && !html.home.includes("/briefings/daily/")) {
  fail("home is missing the daily list and the empty state");
}

for (const file of walk(path.join(root, "_site"))) {
  if (!file.endsWith(".html")) continue;
  assertClean(path.relative(root, file), fs.readFileSync(file, "utf8"));
}

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  return text.slice(start, end < 0 ? text.length : end);
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const cssSource = read("src/css/site.css");
const baseSource = read("src/_includes/base.njk");
for (const token of ["--s-1: 4px", "--s-2: 8px", "--s-3: 12px", "--s-4: 16px", "--s-5: 24px", "--s-6: 32px", "--s-7: 48px", "--s-8: 64px"]) {
  if (!cssSource.includes(token)) fail(`site.css missing spacing token ${token}`);
}
if (!cssSource.includes("--measure: 40rem") || !cssSource.includes("--measure-index: 40rem")) {
  fail("measure must be 40rem");
}
if (cssSource.includes("68rem") || cssSource.includes("#0b3d91") || /gradient\s*\(/i.test(cssSource)) {
  fail("site.css still has the old wide measure, blue links, or a gradient");
}
if (!cssSource.includes('font-family: "Inter"') || /openai\s+sans/i.test(cssSource)) {
  fail("Inter stack missing or OpenAI Sans referenced");
}
const spacingDecls = cssSource.replace(/\/\*[\s\S]*?\*\//g, "").match(/(?:margin|padding|gap)(?:-[a-z]+)*\s*:[^;]+;/g) || [];
for (const decl of spacingDecls) {
  if (/rem/.test(decl)) fail(`spacing uses rem outside the scale: ${decl}`);
  for (const token of decl.match(/(\d+)px/g) || []) {
    if (token !== "6px") fail(`spacing uses a pixel value outside the scale: ${decl}`);
  }
}
const remValues = [...cssSource.matchAll(/(\d*\.\d+|\d+)rem/g)].map((match) => match[1]);
if (remValues.some((value) => value !== "40")) fail(`unexpected rem in site.css: ${remValues.join(", ")}`);

if (!baseSource.includes('localStorage.getItem("brf-theme")') || !baseSource.includes('var storageKey = "brf-theme"')) {
  fail("theme key must be brf-theme");
}
if (baseSource.includes("xgr-theme") || baseSource.includes("ygh-theme")) {
  fail("theme key must stay separate from xgr-theme and ygh-theme");
}
if (!baseSource.includes('class="seg theme-switch"') || !baseSource.includes('aria-label="Color theme"')) {
  fail("theme control must be the shared .seg");
}

for (const [name, text] of Object.entries(html)) {
  if (!text) continue;
  if (!text.includes('class="seg theme-switch"') || !text.includes("brf-theme")) {
    fail(`${name} is missing the theme segment or brf-theme`);
  }
  if (text.includes("#0b3d91")) fail(`${name} still uses the blue link color`);
  if (!text.includes("Public mirror. The briefing in chat (Canvas) remains authoritative.")) {
    fail(`${name} dropped the mirror line`);
  }
}

if (shanghaiDate(new Date("2026-11-05T15:59:00Z")) !== "2026-11-05") {
  fail("Asia/Shanghai date must stay on Nov 5 before 16:00Z");
}
if (shanghaiDate(new Date("2026-11-05T16:30:00Z")) !== "2026-11-06") {
  fail("Asia/Shanghai date must roll to Nov 6 at 16:30Z");
}
for (const [date, week] of [
  ["2026-11-02", "2026-W45"],
  ["2026-11-05", "2026-W45"],
  ["2026-11-08", "2026-W45"],
  ["2026-11-09", "2026-W46"],
  ["2025-12-29", "2026-W01"],
  ["2026-01-01", "2026-W01"],
]) {
  if (isoWeekId(date) !== week) fail(`iso week of ${date} was ${isoWeekId(date)}, expected ${week}`);
}
if (FOLD_STEP !== 5) fail("archive More step must be 5");
for (const [shown, total, expectedShown, more] of [
  [0, 12, 5, true],
  [5, 12, 10, true],
  [10, 12, 12, false],
  [0, 1, 1, false],
  [0, 0, 0, false],
]) {
  const page = nextFoldCount(shown, total);
  if (page.shown !== expectedShown || page.more !== more) {
    fail(`fold ${shown}/${total} => ${page.shown} more=${page.more}, expected ${expectedShown} more=${more}`);
  }
}

const briefings = loadBriefings(path.join(root, "content"));
const stage = selectStage(briefings, new Date("2026-11-05T04:00:00Z"));
if (!stage.daily || stage.daily.date !== "2026-11-05" || stage.week !== "2026-W45" || !stage.weekly) {
  fail(`stage selector missed the sample day/week: ${JSON.stringify({ date: stage.date, week: stage.week, daily: stage.daily && stage.daily.date, weekly: stage.weekly && stage.weekly.week })}`);
}
const missedDay = selectStage(briefings, new Date("2026-11-06T04:00:00Z"));
if (missedDay.daily || !missedDay.weekly || missedDay.week !== "2026-W45") {
  fail("stage selector should keep this week's weekly when today's daily is missing");
}
const missedBoth = selectStage(briefings, new Date("2026-12-01T04:00:00Z"));
if (missedBoth.daily || missedBoth.weekly) fail("stage selector should be empty off the sample week");

const builtStage = selectStage(briefings);
const indexSource = read("src/index.njk");
const emptyCopy = {
  both: "No briefing for today or this week yet.",
  daily: "No daily briefing for today yet.",
  weekly: "No weekly briefing for this week yet.",
};
for (const copy of Object.values(emptyCopy)) {
  if (!indexSource.includes(copy)) fail(`index template missing empty copy: ${copy}`);
}
if (indexSource.includes("Latest")) fail("index must not keep a Latest section beside the stage");
if (!indexSource.includes(">Now<")) fail("stage heading must be Now");
if (!html.home.includes('id="now-heading"') || !html.home.includes(">Now<")) {
  fail("home is missing the Now stage");
}
if (html.home.includes('id="latest"') || html.home.includes("Latest daily") || html.home.includes("Latest weekly")) {
  fail("Latest must be replaced by the Now stage, not kept as a third block");
}
const stageHtml = sliceBetween(html.home, 'id="now-heading"', 'id="daily"');
if (!stageHtml) fail("Now stage must sit above the Daily archive");
if (html.home.indexOf('id="now-heading"') > html.home.indexOf('id="daily"')) {
  fail("Now stage must sit above the Daily archive");
}
if (html.home.indexOf('id="daily"') > html.home.indexOf('id="weekly"')) {
  fail("archive anchors must stay Daily then Weekly");
}

function assertEntry(slice, label, href, blurb, meta) {
  const open = `<a class="entry" href="${href}">`;
  const start = slice.indexOf(open);
  const end = start < 0 ? -1 : slice.indexOf("</a>", start);
  const row = start < 0 || end < 0 ? "" : slice.slice(start, end);
  if (!row) {
    fail(`entry row is missing or not a whole-row link: ${label}`);
    return;
  }
  if (!row.includes(`class="entry-title">${label}</span>`)) fail(`entry title missing: ${label}`);
  if (meta && !row.includes(meta)) fail(`entry meta missing ${meta} on ${label}`);
  if (!row.includes(htmlEscape(blurb))) fail(`entry is missing the conclusion excerpt: ${label}`);
}

if (builtStage.daily) {
  assertEntry(
    stageHtml,
    builtStage.daily.date,
    `/briefings/daily/${builtStage.daily.date}/`,
    excerpt(builtStage.daily.summary, 150),
    "Today",
  );
} else if (!stageHtml.includes(builtStage.weekly ? emptyCopy.daily : emptyCopy.both)) {
  fail("missing daily stage row has no empty state");
}
if (builtStage.weekly) {
  assertEntry(
    stageHtml,
    builtStage.weekly.week,
    `/briefings/weekly/${builtStage.weekly.week}/`,
    excerpt(builtStage.weekly.summary, 150),
    "This week",
  );
} else if (!stageHtml.includes(builtStage.daily ? emptyCopy.weekly : emptyCopy.both)) {
  fail("missing weekly stage row has no empty state");
}
if (builtStage.daily && builtStage.weekly) {
  for (const copy of Object.values(emptyCopy)) {
    if (html.home.includes(copy)) fail(`stage showed an empty state while both rows exist: ${copy}`);
  }
}
if (!builtStage.daily && builtStage.weekly && !stageHtml.includes(emptyCopy.daily)) {
  fail("daily-only miss copy missing");
}
if (builtStage.daily && !builtStage.weekly && !stageHtml.includes(emptyCopy.weekly)) {
  fail("weekly-only miss copy missing");
}
if (!builtStage.daily && !builtStage.weekly && !stageHtml.includes(emptyCopy.both)) {
  fail("dual-miss copy missing");
}

const dailyArchive = sliceBetween(html.home, 'id="daily"', 'id="weekly"');
const weeklyArchive = sliceBetween(html.home, 'id="weekly"', "</main>");
if (!dailyArchive.includes(">Daily<") || !weeklyArchive.includes(">Weekly<")) {
  fail("archive headings must stay on #daily and #weekly");
}
for (const item of briefings.daily) {
  const href = `/briefings/daily/${item.date}/`;
  if (!dailyArchive.includes(`href="${href}"`)) fail(`archive dropped daily ${item.date}`);
  const occurrences = html.home.split(href).length - 1;
  const onStage = builtStage.daily && builtStage.daily.date === item.date;
  if (onStage && occurrences < 2) fail(`today's daily must stay in the archive as well as the stage`);
}
for (const item of briefings.weekly) {
  const href = `/briefings/weekly/${item.week}/`;
  if (!weeklyArchive.includes(`href="${href}"`)) fail(`archive dropped weekly ${item.week}`);
  const occurrences = html.home.split(href).length - 1;
  const onStage = builtStage.weekly && builtStage.weekly.week === item.week;
  if (onStage && occurrences < 2) fail(`this week's weekly must stay in the archive as well as the stage`);
}
const note = "Enable JavaScript to load more.";
if (briefings.daily.length > 5) {
  if (!dailyArchive.includes(note)) fail("daily no-JS fold note missing");
} else if (dailyArchive.includes(note)) {
  fail("daily fold note should appear only when more than 5 rows exist");
}
if (briefings.weekly.length > 5) {
  if (!weeklyArchive.includes(note)) fail("weekly no-JS fold note missing");
} else if (weeklyArchive.includes(note)) {
  fail("weekly fold note should appear only when more than 5 rows exist");
}
if (indexSource.includes("<noscript")) fail("no-JS degradation is the static five-row cap, not a noscript list");
const moreCount = (html.home.match(/class="more"/g) || []).length;
const expectedMore = (briefings.daily.length ? 1 : 0) + (briefings.weekly.length ? 1 : 0);
if (moreCount !== expectedMore) fail(`expected ${expectedMore} More controls, found ${moreCount}`);
if (!html.home.includes('data-fold="daily"') || !html.home.includes('data-fold="weekly"')) {
  fail("Daily and Weekly archives must fold independently");
}
if (!html.home.includes("/briefings/js/fold.js")) fail("home is missing the archive fold script");
if (!baseSource.includes('classList.add("js")')) fail("js class must be set before first paint");

const narrowStart = cssSource.indexOf("@media (max-width: 380px)");
const narrowEnd = cssSource.indexOf("@media", narrowStart + 10);
const narrow = narrowStart < 0 ? "" : cssSource.slice(narrowStart, narrowEnd < 0 ? undefined : narrowEnd);
if (!narrow) fail("missing the 380px header breakpoint");
for (const piece of ["height: auto", "flex-wrap: wrap", "row-gap: var(--s-2)", "min-height: 44px"]) {
  if (!narrow.includes(piece)) fail(`380 header missing ${piece}`);
}
if (!narrow.includes(".seg") || !/flex:\s*1\s*0\s*100%/.test(narrow)) {
  fail("at 380px .seg must sit on its own full row");
}
if (/overflow\s*:\s*hidden/.test(narrow)) fail("380 layout must not clip Night with overflow:hidden");
if (!cssSource.includes("height: 44px")) fail("theme hit target must stay 44px");
if (!cssSource.includes("border-bottom: 1px solid var(--line)")) fail("header hairline must stay 1px --line");
if (cssSource.includes("#111")) fail("header must not bring back a thick #111 bar");
if (!cssSource.includes(":nth-child(n + 6)") || !cssSource.includes("html.js") || !cssSource.includes(".is-open")) {
  fail("archive fold CSS must hide rows after five without JS and reveal .is-open with JS");
}

if (!html.home.includes('class="lede"') || !html.home.includes("Daily and weekly intelligence, mirrored for the public web.")) {
  fail("home lede is missing");
}

function assertOrder(name, text, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const at = text.indexOf(marker, cursor + 1);
    if (at < 0) {
      fail(`${name} is missing ${marker}`);
      return;
    }
    if (at <= cursor) {
      fail(`${name} order failed at ${marker}`);
      return;
    }
    cursor = at;
  }
}
if (html.daily) {
  assertOrder("daily", html.daily, ['id="conclusion"', 'id="hot"', 'id="metrics"', 'id="news"']);
  const metrics = sliceBetween(html.daily, 'id="metrics"', 'id="news"');
  if (metrics.includes("<table") || metrics.includes(">Metric<")) fail("daily metrics is still a metric table");
  if (!metrics.includes("News 16")) fail("daily metrics line missing");
  if (!html.daily.includes('class="conclusion"')) fail("daily conclusion block missing");
  if (!html.daily.includes('aria-current="page">Daily')) fail("daily page does not mark the Daily nav");
}
if (html.weekly) {
  assertOrder("weekly", html.weekly, ['id="conclusion"', 'id="hot"', 'id="metrics"', 'id="decisions"', 'id="news"']);
  const metrics = sliceBetween(html.weekly, 'id="metrics"', 'id="decisions"');
  if (metrics.includes("<table") || metrics.includes(">Metric<")) fail("weekly metrics is still a metric table");
  if (!html.weekly.includes('class="decision"')) fail("weekly decisions are missing the hairline article");
  if (!html.weekly.includes('aria-current="page">Weekly')) fail("weekly page does not mark the Weekly nav");
}

function assertPagesParity(name, text, data) {
  if (!text) return;
  const head = text.indexOf('class="page-head"');
  const toc = text.indexOf('<nav class="toc"');
  const conclusion = text.indexOf('id="conclusion"');
  if (!(head >= 0 && toc > head && conclusion > toc)) {
    fail(`${name} TOC must sit between page-head and Conclusion`);
  }
  if (!text.includes(">On this page<")) fail(`${name} is missing the On this page label`);
  if (text.includes("<h4>First source</h4>")) fail(`${name} still renders First source as a body heading`);
  if (text.includes("text-overflow:ellipsis") || text.includes("text-overflow: ellipsis")) {
    fail(`${name} truncates a title`);
  }
  const notes = withNotes(data.news);
  notes.forEach((item, index) => {
    if (!text.includes(`id="note-${index + 1}"`)) fail(`${name} is missing id note-${index + 1}`);
  });
  const decisions = data.decisions || [];
  decisions.forEach((card, index) => {
    if (!text.includes(`id="decision-${index + 1}"`)) fail(`${name} is missing id decision-${index + 1}`);
  });
  if (notes.length >= 3) {
    const groups = tocGroups(notes, "note");
    const notesToc = sliceBetween(text, 'href="#notes"', 'href="#papers"');
    let cursor = -1;
    for (const group of groups) {
      const labelAt = notesToc.indexOf(htmlEscape(group.label));
      if (labelAt < 0) fail(`${name} notes TOC is missing group ${group.label}`);
      if (labelAt < cursor) fail(`${name} notes TOC group order failed at ${group.label}`);
      cursor = labelAt;
      if (!notesToc.includes(`class="toc-count">${group.items.length}<`)) {
        fail(`${name} notes TOC is missing the count for ${group.label}`);
      }
      let itemCursor = labelAt;
      for (const item of group.items) {
        const href = `href="#${item.anchor}"`;
        const at = notesToc.indexOf(href, itemCursor);
        if (at < 0) fail(`${name} notes TOC is missing ${item.anchor} in ${group.label}`);
        if (!notesToc.includes(htmlEscape(item.title))) fail(`${name} notes TOC truncated ${item.anchor}`);
        itemCursor = at + 1;
      }
    }
  }
  if (decisions.length >= 2) {
    const groups = tocGroups(decisions, "decision");
    const decisionToc = sliceBetween(text, 'href="#decisions"', 'href="#news"');
    for (const group of groups) {
      if (!decisionToc.includes(htmlEscape(group.label))) fail(`${name} decisions TOC is missing group ${group.label}`);
      for (const item of group.items) {
        if (!decisionToc.includes(`href="#${item.anchor}"`)) {
          fail(`${name} decisions TOC is missing ${item.anchor}`);
        }
        if (!decisionToc.includes(htmlEscape(item.title))) fail(`${name} decisions TOC truncated ${item.anchor}`);
      }
    }
  }
  const hot = selectHot(data);
  const hotHtml = sliceBetween(text, 'id="hot"', 'id="metrics"');
  if (!hot.length) {
    if (text.includes("Hot this wave")) fail(`${name} rendered Hot this wave without data`);
  } else {
    if (!hotHtml.includes("Hot this wave")) fail(`${name} is missing Hot this wave`);
    if (!hotHtml.includes("hot-jump")) fail(`${name} hot list is not clickable`);
    let cursor = -1;
    for (const item of hot) {
      const href = `href="${item.href}"`;
      const at = hotHtml.indexOf(href, cursor);
      if (at < 0) fail(`${name} hot list is missing ${item.href}`);
      if (!hotHtml.includes(htmlEscape(item.title))) fail(`${name} hot list truncated ${item.href}`);
      cursor = at + 1;
    }
  }
  const cardRe = /<article class="card"[\s\S]*?(?=<article class="card"|<section |$)/g;
  const cards = text.match(cardRe) || [];
  if (cards.length !== notes.length) fail(`${name} card count ${cards.length} != notes ${notes.length}`);
  cards.forEach((card, index) => {
    const item = notes[index];
    if (item.first_source_at) {
      const strip = card.indexOf('class="first-source"');
      const background = card.indexOf("<h4>Background</h4>");
      const facts = card.indexOf("<h4>Facts</h4>");
      if (strip < 0) fail(`${name} note-${index + 1} is missing the First source strip`);
      if (background >= 0 && strip > background) fail(`${name} note-${index + 1} First source is after Background`);
      if (facts >= 0 && strip > facts) fail(`${name} note-${index + 1} First source is after Facts`);
    }
    const labels = [...card.matchAll(/<h4>([^<]+)<\/h4>/g)].map((match) => match[1]);
    const expected = ["Background", "Facts", "Why it matters", "Architecture impact", "Links"].filter((label) => {
      if (label === "Background") return item.background;
      if (label === "Facts") return item.facts;
      if (label === "Why it matters") return item.why;
      if (label === "Architecture impact") return item.arch_impact;
      return item.links && item.links.length;
    });
    if (labels.join("|") !== expected.join("|")) {
      fail(`${name} note-${index + 1} section order ${labels.join("|")}`);
    }
  });
  const tdCount = (text.match(/<td\b/g) || []).length;
  const labelCount = (text.match(/data-label="/g) || []).length;
  if (tdCount !== labelCount) fail(`${name} data-label count ${labelCount} != td count ${tdCount}`);
  if (!text.includes('<button type="button" class="back-to-top"') || !text.includes(">Top</button>")) {
    fail(`${name} is missing the Top button`);
  }
}

if (html.daily) assertPagesParity("daily", html.daily, dailyJson);
if (html.weekly) assertPagesParity("weekly", html.weekly, weeklyJson);
if (html.home && html.home.includes('class="back-to-top"')) fail("home should not render BackToTop");
if (html.home && html.home.includes('class="toc"')) fail("home should not render a detail TOC");

if (!cssSource.includes("scroll-margin-top: calc(var(--s-7) + var(--s-3))")) {
  fail("section targets are missing scroll-margin-top");
}
if (!cssSource.includes("content: attr(data-label)") || !cssSource.includes("@media (max-width: 640px)")) {
  fail("mobile tables are missing the card stack");
}
if (!cssSource.includes("overflow-x: clip")) fail("page is missing horizontal clip");
if (/text-overflow\s*:\s*ellipsis/.test(cssSource)) fail("site.css ellipsizes text");
if (!baseSource.includes('nav.toc a[href^="#"]') || !baseSource.includes(".hot-picks a[href^=\"#\"]")) {
  fail("smooth scroll does not intercept TOC and hot jumps");
}
if (!baseSource.includes("scrollIntoView") || !baseSource.includes('block: "start"')) {
  fail("smooth scroll is missing scrollIntoView block start");
}
if (!baseSource.includes("(prefers-reduced-motion: reduce)") || !baseSource.includes('"smooth"') || !baseSource.includes('"auto"')) {
  fail("reduced motion does not switch scroll behavior to auto");
}
if (!baseSource.includes("replaceState")) fail("in-page jumps do not call history.replaceState");
if (!baseSource.includes('button type="button" class="back-to-top"')) fail("BackToTop is not a public button");
if (!cssSource.includes("border-left: 2px solid var(--ink)")) fail("conclusion is missing the ink rule");
if (!fs.existsSync(path.join(root, "_site/fonts/inter-latin-wght-normal.woff2"))) {
  fail("missing self-hosted Inter latin font");
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("public check ok");
console.log(Object.values(pages).join("\n"));
