import fs from "node:fs";
import path from "node:path";
import { excerpt } from "../lib/excerpt.js";
import { FOLD_STEP, nextFoldCount } from "../src/js/fold.js";
import { loadBriefings } from "../lib/load-briefings.js";
import { isoWeekId, selectStage, shanghaiDate } from "../lib/stage.js";
import {
  compactStars,
  dailyPropertyRows,
  detailCards,
  displayTitle,
  finalJudgments,
  isoWeekRangeLabel,
  remainderNews,
  saSteps,
  selectHot,
  weeklyPropertyRows,
} from "../lib/pages-parity.js";
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
if (displayTitle({ id: 1, domain: "AI产品", title: "#1 · AI产品 · Hello" }) !== "Hello") {
  fail("displayTitle did not strip a baked #N · domain prefix");
}
if (displayTitle({ title: "Plain title" }) !== "Plain title") {
  fail("displayTitle changed a title that has no #N prefix");
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
  "daily-2026-11-06": "_site/daily/2026-11-06/index.html",
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
if (html.home && !html.home.includes("/briefings/daily/2026-11-06/")) {
  fail("home is missing the 2026-11-06 daily path");
}
if (html.home && !html.home.includes("/briefings/weekly/2026-W45/")) {
  fail("home is missing the weekly pathPrefix link");
}
if (html.daily && !html.daily.includes("https://yurkingw.github.io/briefings/daily/2026-11-05/")) {
  fail("daily absolute URL is missing the baseUrl");
}
if (html["daily-2026-11-06"] && !html["daily-2026-11-06"].includes("https://yurkingw.github.io/briefings/daily/2026-11-06/")) {
  fail("2026-11-06 absolute URL is missing the baseUrl");
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

const todayPage = html["daily-2026-11-06"];
if (todayPage) {
  assertNoToc("2026-11-06", todayPage);
  for (const label of ["今日主线", "要闻", "政治金融", "顶尖论文", "GitHub", "附录"]) {
    if (!todayPage.includes(label)) fail(`2026-11-06 page missing label ${label}`);
  }
  if (!todayPage.includes("晨间") || !todayPage.includes(">午间<")) fail("2026-11-06 page dropped a wave tab");
  if (!todayPage.includes('datetime="2026-11-06T13:58:00+08:00"')) {
    fail("2026-11-06 updated_at drifted");
  }
  if (!/要闻条数<\/dt>\s*<dd[^>]*>27<\/dd>/.test(todayPage) || !/政治金融<\/dt>\s*<dd[^>]*>7<\/dd>/.test(todayPage)) {
    fail("2026-11-06 news or polfin count drifted");
  }
  if (!todayPage.includes("pf-20261106-01")) fail("2026-11-06 polfin row is not on the page");
  if ((todayPage.includes("€100") || todayPage.includes("$133")) && !/unconfirmed/i.test(todayPage)) {
    fail("2026-11-06 states an unconfirmed amount without the unconfirmed marker");
  }
}
if (html.daily) {
  for (const label of ["今日主线", "要闻", "顶尖论文", "附录", "本波最热"]) {
    if (!html.daily.includes(label)) fail(`daily page missing label ${label}`);
  }
  if (!html.daily.includes("午间")) fail("daily page dropped original-language body text");
  if ((html.daily.includes("$133") || html.daily.includes("€1.18") || html.daily.includes("1.33")) && !/unconfirmed/i.test(html.daily)) {
    fail("daily page states an unconfirmed amount without the unconfirmed marker");
  }
}
if (html.weekly) {
  for (const label of ["本周主线", "要闻", "金融决策", "最终判断"]) {
    if (!html.weekly.includes(label)) fail(`weekly page missing label ${label}`);
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
const openedDay = selectStage(briefings, new Date("2026-11-06T04:00:00Z"));
if (!openedDay.daily || openedDay.daily.date !== "2026-11-06" || openedDay.week !== "2026-W45" || !openedDay.weekly) {
  fail("stage selector should surface 2026-11-06 and keep this week's weekly");
}
const missedDay = selectStage(briefings, new Date("2026-11-07T04:00:00Z"));
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
  const open = `<a class="entry hit-row" href="${href}">`;
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
  if (builtStage.daily.date === "2026-11-06" && !stageHtml.includes(builtStage.daily.wave)) {
    fail("home Now stage dropped today's wave");
  }
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

const narrowStart = cssSource.indexOf("@media (max-width: 390px)");
const narrowEnd = cssSource.indexOf("@media", narrowStart + 10);
const narrow = narrowStart < 0 ? "" : cssSource.slice(narrowStart, narrowEnd < 0 ? undefined : narrowEnd);
if (!narrow) fail("missing the 390px header breakpoint");
for (const piece of ["height: auto", "flex-wrap: wrap", "row-gap: var(--s-2)", "min-height: 44px"]) {
  if (!narrow.includes(piece)) fail(`390 header missing ${piece}`);
}
if (!narrow.includes(".seg") || !/flex:\s*1\s*0\s*100%/.test(narrow)) {
  fail("at 390px .seg must sit on its own full row");
}
if (/overflow\s*:\s*hidden/.test(narrow)) fail("390 layout must not clip Night with overflow:hidden");
if (!cssSource.includes("--accent: #2f5f9e") || !cssSource.includes("--accent: #b54a4a")) {
  fail("day-blue / night-red accent tokens changed");
}
if (!cssSource.includes("height: 44px")) fail("theme hit target must stay 44px");
if (!cssSource.includes("border-bottom: 1px solid var(--line)")) fail("header hairline must stay 1px --line");
if (cssSource.includes("#111")) fail("header must not bring back a thick #111 bar");
if (!cssSource.includes(":nth-child(n + 6)") || !cssSource.includes("html.js") || !cssSource.includes(".is-open")) {
  fail("archive fold CSS must hide rows after five without JS and reveal .is-open with JS");
}

if (!html.home.includes('class="lede"') || !html.home.includes("Daily and weekly intelligence, mirrored for the public web.")) {
  fail("home lede is missing");
}
assertChrome("home", html.home);
if (!html.home.includes('id="daily"') || !html.home.includes('id="weekly"') || !html.home.includes(">Daily<") || !html.home.includes(">Weekly<")) {
  fail("home archive headings must stay");
}
const stackStart = cssSource.indexOf("@media (max-width: 640px)");
const stackEnd = cssSource.indexOf("@media", stackStart + 10);
const stack = stackStart < 0 ? "" : cssSource.slice(stackStart, stackEnd < 0 ? undefined : stackEnd);
if (!/th,\s*\ntd\s*\{[^}]*padding-left:\s*var\(--s-4\)/.test(cssSource) || !/th,\s*\ntd\s*\{[^}]*padding-right:\s*var\(--s-4\)/.test(cssSource)) {
  fail("E5 desktop table cells are missing 16px inline padding");
}
if (!stack.includes("padding-inline: var(--inset-row)")) fail("E6 stacked tables are missing inset-row");
if (/padding:\s*var\(--s-2\)\s+0/.test(stack)) fail("E6 stacked td still has zero inline padding");
if (html.home) {
  const homeTops = html.home.match(/class="back-to-top"/g) || [];
  if (homeTops.length !== 1 || !html.home.includes(">回顶</button>")) fail("home must have exactly one 回顶 control");
  if (html.home.includes("back-page") || html.home.includes("回到顶部") || html.home.includes(">Top</button>")) {
    fail("home still has a second back control");
  }
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

function firstBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = text.indexOf(endMarker, start + startMarker.length);
  return text.slice(start, end < 0 ? text.length : end);
}

function propertyPairs(text) {
  const block = firstBlock(text, 'id="metrics"', "</dl>");
  const labels = [...block.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => match[1]);
  const values = [...block.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  );
  return { labels, values };
}

function tabLabels(bar) {
  return [...bar.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1].trim());
}

function openingTag(text, id) {
  const at = text.indexOf(`id="${id}"`);
  if (at < 0) return "";
  const start = text.lastIndexOf("<", at);
  const end = text.indexOf(">", at);
  return text.slice(start, end + 1);
}

function assertNoToc(name, text) {
  for (const marker of [
    '<nav class="toc"',
    "toc-sections",
    'aria-label="On this page"',
    ">On this page<",
    "toc-group",
    "toc-index",
    "TableOfContents",
  ]) {
    if (text.includes(marker)) fail(`${name} still renders an in-page TOC (${marker})`);
  }
}

function spanText(row, className) {
  const match = row.match(new RegExp(`<span class="${className}"[^>]*>([\\s\\S]*?)</span>`));
  return match ? match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}

function assertGithubRows(name, panelHtml, rows, idPrefix) {
  const cards = [...panelHtml.matchAll(/<a class="brf-row hit-row"[\s\S]*?<\/a>/g)].map((match) => match[0]);
  if (cards.length !== rows.length) fail(`${name} row count ${cards.length} != ${rows.length}`);
  const details = panelHtml.match(/<article class="gh-detail"[\s\S]*?<\/article>/g) || [];
  if (details.length !== rows.length) fail(`${name} detail count ${details.length} != ${rows.length}`);
  rows.forEach((item, index) => {
    const row = cards[index] || "";
    const title = spanText(row, "brf-row-title");
    const detail = spanText(row, "brf-row-detail");
    const slogan = (item.slogan || "—").replace(/\s+/g, " ").trim();
    if (title !== item.repo) fail(`${name} title ${index + 1} is "${title}"`);
    if (detail !== slogan) fail(`${name} slogan ${index + 1} is "${detail}"`);
    if (item.slogan && item.slogan !== item.repo && title.includes(item.slogan)) {
      fail(`${name} slogan is glued into the title`);
    }
    if (item.what && title.includes(item.what)) fail(`${name} what is glued into the title`);
    if (item.why && title.includes(item.why)) fail(`${name} why is glued into the title`);
    if (item.break && (!row.includes('data-tone="danger"') || !row.includes(item.break))) {
      fail(`${name} break status missing for ${item.repo}`);
    }
    if (!row.includes('class="brf-status"')) fail(`${name} row is missing a status pill`);
    if (!row.includes('class="brf-row-meta"')) fail(`${name} row is missing meta`);
    const card = details[index] || "";
    if (!card.includes(`id="${idPrefix}-${item.rank}"`)) fail(`${name} detail id missing for ${item.repo}`);
    for (const key of ["是什么", "为什么涨", "+N/窗", "总星", "上线", "链接"]) {
      if (!card.includes(`>${key}<`)) fail(`${name} detail missing ${key}`);
    }
    const heading = (card.match(/<h3>([^<]*)<\/h3>/) || [])[1] || "";
    if (item.slogan && heading.includes(item.slogan)) fail(`${name} detail heading glues the slogan`);
    if (item.url && !card.includes(item.url)) fail(`${name} detail dropped the repo URL`);
  });
}

if (compactStars(15008) !== "15k" || compactStars(4892) !== "4.9k" || compactStars(96483) !== "96.5k" || compactStars(6563) !== "6.6k") {
  fail(`compactStars mismatch ${[compactStars(15008), compactStars(4892), compactStars(96483), compactStars(6563)].join(" ")}`);
}
if (isoWeekRangeLabel("2026-W45", "Asia/Shanghai") !== "2026-11-02 周一 → 2026-11-08 周日（Asia/Shanghai）") {
  fail(`week window was ${isoWeekRangeLabel("2026-W45", "Asia/Shanghai")}`);
}

const dailyProps = dailyPropertyRows(dailyJson);
const weeklyProps = weeklyPropertyRows(weeklyJson);
if (dailyProps.map((row) => row.label).join("|") !== "日期|最后更新|要闻条数|全日累计|finsec|论文篇数|关注流相关|GitHub") {
  fail("daily property key order drifted");
}
if (weeklyProps.map((row) => row.label).join("|") !== "窗口|本周条目|政治金融|AI 产品 / 科技|AI 安全|其他安全 / 加密|壳") {
  fail("weekly property key order drifted");
}
const weeklySteps = saSteps(weeklyJson.decisions);
if (!weeklySteps.length || weeklySteps[0].level !== "P0" || !weeklySteps.some((step) => step.level === "P2")) {
  fail("SA steps are not ordered P0 through P2");
}
if (finalJudgments(weeklyJson.decisions).length < 1) fail("weekly judgments missing");

function assertPageChrome(name, text) {
  if (!text) return;
  assertNoToc(name, text);
  if (!text.includes('class="brf-properties"') || !text.includes('class="brf-callout"')) {
    fail(`${name} is missing Properties or Callout`);
  }
  if (!text.includes('id="page-top"')) fail(`${name} is missing #page-top`);
  const tops = text.match(/class="back-to-top"/g) || [];
  if (tops.length !== 1) fail(`${name} back-to-top count ${tops.length}`);
  if (!text.includes(">回顶</button>")) fail(`${name} floating label is not 回顶`);
  if (text.includes("back-page") || text.includes("回到顶部") || text.includes(">Top</button>")) {
    fail(`${name} still has a second back control`);
  }
  const bars = [...text.matchAll(/<div class="page-tabs[\s\S]*?<\/div>/g)].map((match) => match[0]);
  if (bars.length < 2) fail(`${name} is missing the bottom segmented control`);
  if (tabLabels(bars[0]).join("|") !== tabLabels(bars[1]).join("|")) {
    fail(`${name} top and bottom tabs differ`);
  }
  const tdCount = (text.match(/<td\b/g) || []).length;
  const labelCount = (text.match(/data-label="/g) || []).length;
  if (tdCount !== labelCount) fail(`${name} data-label count ${labelCount} != td count ${tdCount}`);
}

if (html.daily) {
  assertPageChrome("daily", html.daily);
  assertOrder("daily", html.daily, [
    'class="page-head"',
    'id="metrics"',
    'id="conclusion"',
    ">今日主线<",
    'id="page-top"',
    ">要闻<",
    'id="panel-news"',
    'id="hot"',
    ">本波最热<",
    'class="detail-cards"',
    'id="remainder"',
    ">其余要点<",
    'id="panel-papers"',
    'id="panel-github"',
    'id="panel-appendix"',
    ">全日累计（去重）<",
    'class="brf-link-cards"',
  ]);
  const shown = propertyPairs(html.daily);
  if (shown.labels.join("|") !== dailyProps.map((row) => row.label).join("|")) {
    fail(`daily properties ${shown.labels.join("|")}`);
  }
  dailyProps.forEach((row, index) => {
    if (String(shown.values[index]) !== String(row.value)) {
      fail(`daily property ${row.label} is "${shown.values[index]}"`);
    }
  });
  if (!html.daily.includes('data-tone="warning"') || !html.daily.includes('class="brf-callout-lead">结论<')) {
    fail("daily mainline is not a warning callout");
  }
  const tabs = tabLabels(firstBlock(html.daily, 'class="page-tabs', "</div>"));
  if (tabs.join("|") !== "要闻|政治金融|顶尖论文|GitHub|附录") fail(`S1 tabs ${tabs.join("|")}`);
  const bar = firstBlock(html.daily, 'class="page-tabs', "</div>");
  if (!/aria-controls="panel-news"[^>]*aria-selected="true"/.test(bar)) fail("S1 default tab is not 要闻");
  for (const id of ["panel-polfin", "panel-papers", "panel-github", "panel-appendix"]) {
    const open = openingTag(html.daily, id);
    if (!open.includes(" hidden")) fail(`S1 ${id} is not hidden`);
    if (!open.includes("inert")) fail(`S1 ${id} is not inert`);
  }
  if (openingTag(html.daily, "panel-news").includes(" hidden")) fail("S1 要闻 panel is hidden");
  if (!html.daily.includes(">晨间<") || !html.daily.includes(">午间<")) fail("S2 wave tabs missing");
  const morning = openingTag(html.daily, "wave-morning");
  const afternoon = openingTag(html.daily, "wave-afternoon");
  if (!morning.includes(" hidden") || afternoon.includes(" hidden")) fail("S2 default wave is not 午间");
  const notes = detailCards(dailyJson.news);
  const cards = html.daily.match(/<article class="detail-card"[\s\S]*?<\/article>/g) || [];
  if (cards.length !== notes.length) fail(`S2 card count ${cards.length} != ${notes.length}`);
  if (cards.length > 10) fail("S2 rendered more than 10 detail cards");
  cards.forEach((card, index) => {
    const item = notes[index];
    if (!card.includes(`id="note-${item.id}"`)) fail(`S2 missing note-${item.id}`);
    if (!card.includes(`>#${item.id} · ${item.domain} ·`)) fail(`S2 heading for note-${item.id}`);
    const labels = [...card.matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1]);
    const expected = ["背景", "事实", "为何重要", "架构冲击", "通路", "最早来源·时间", "链接"].filter((label) => {
      if (label === "背景") return item.background;
      if (label === "事实") return item.facts;
      if (label === "为何重要") return item.why;
      if (label === "架构冲击") return item.arch_impact;
      if (label === "通路") return item.channel;
      if (label === "最早来源·时间") return item.first_source_at;
      return item.links && item.links.length;
    });
    if (labels.join("|") !== expected.join("|")) fail(`C-D2 note-${item.id} fields ${labels.join("|")}`);
  });
  const rest = remainderNews(dailyJson.news);
  const remainderHtml = sliceBetween(html.daily, 'id="remainder"', 'id="panel-polfin"');
  for (const header of ["#", "领域", "标题", "通路", "最早源时", "链接"]) {
    if (!remainderHtml.includes(`>${header}<`)) fail(`S2 remainder missing ${header}`);
  }
  const cardsHtml = cards.join("\n");
  for (const item of rest) {
    if (cardsHtml.includes(`id="note-${item.id}"`)) fail(`S2 non-detail ${item.id} is a detail card`);
  }
  for (const item of notes) {
    if (remainderHtml.includes(`>#${item.id}<`) || remainderHtml.includes(`>${item.id}<`)) {
      fail(`S2 detail ${item.id} is also in the remainder table`);
    }
  }
  const hot = selectHot(dailyJson);
  const hotHtml = sliceBetween(html.daily, 'id="hot"', 'class="detail-cards"');
  if (!hotHtml.includes("本波最热") || !hotHtml.includes("hot-jump")) fail("S2 hot list missing");
  hot.forEach((item) => {
    if (!hotHtml.includes(`href="${item.href}"`)) fail(`S2 hot list missing ${item.href}`);
  });
  const papers = sliceBetween(html.daily, 'id="panel-papers"', 'id="panel-github"');
  for (const header of ["抢了什么", "要点", "为何值得看", "链接"]) {
    if (!papers.includes(`>${header}<`)) fail(`S3 papers missing ${header}`);
  }
  if (!papers.includes(">本波必读<")) fail("F1 papers lead list missing");
  if (!papers.includes('class="brf-callout"') || !papers.includes(">窗口<")) fail("S3 papers window callout missing");
  for (const paper of dailyJson.papers) {
    if (!papers.includes(`href="${paper.url}"`)) fail(`S3 missing paper url ${paper.url}`);
    if (paper.dair_url && !papers.includes(`href="${paper.dair_url}"`)) fail("S3 missing dair url");
  }
  const rising = sliceBetween(html.daily, 'id="gh-rising"', 'id="gh-newcomers"');
  const newcomers = sliceBetween(html.daily, 'id="gh-newcomers"', 'id="gh-summary"');
  assertGithubRows("S4 rising", rising, dailyJson.github.rising.slice(0, 5), "gh-rising");
  assertGithubRows("S4 newcomers", newcomers, dailyJson.github.newcomers.slice(0, 5), "gh-newcomer");
  if (!rising.includes(">其余仓库<") || !newcomers.includes(">其余仓库<")) fail("F2 rest repo table missing");
  if (!/aria-controls="gh-rising"[^>]*aria-selected="true"/.test(html.daily)) fail("S4 涨星榜 is not the default GitHub tab");
  if (!html.daily.includes(">涨星榜<") || !html.daily.includes(">新锐榜<") || !html.daily.includes(">总结<")) {
    fail("S4 GitHub sub-tabs missing");
  }
  const summary = sliceBetween(html.daily, 'id="gh-summary"', 'id="panel-appendix"');
  if (summary.includes("<table")) fail("S4 总结 is a wide table");
  if (!summary.includes(">口径<")) fail("S4 总结 is missing the 口径 callout");
  if (!summary.includes("缺源")) fail("S4 总结 dropped the archive note");
  const appendix = sliceBetween(html.daily, 'id="panel-appendix"', 'class="page-tabs page-tabs-bottom');
  for (const header of ["#", "栏", "领域", "标题", "波次", "通路", "finsec", "链接"]) {
    if (!appendix.includes(`>${header}<`)) fail(`S5 appendix missing ${header}`);
  }
  if (!html.daily.includes('class="brf-rows"') || !html.daily.includes('class="brf-status"')) {
    fail("daily is missing Rows or Status");
  }
  assertChrome("daily", html.daily);
}

if (html.weekly) {
  assertPageChrome("weekly", html.weekly);
  assertOrder("weekly", html.weekly, [
    'class="page-head"',
    'id="metrics"',
    'id="conclusion"',
    ">本周主线<",
    'id="page-top"',
    ">要闻<",
    'id="panel-news"',
    'id="weekly-news"',
    ">代表来源<",
    'class="brf-link-cards"',
    'id="panel-papers"',
    'id="panel-github"',
    'id="panel-decisions"',
    'data-tone="danger"',
    'class="brf-steps"',
    ">最终判断<",
  ]);
  const shown = propertyPairs(html.weekly);
  if (shown.labels.join("|") !== weeklyProps.map((row) => row.label).join("|")) {
    fail(`weekly properties ${shown.labels.join("|")}`);
  }
  weeklyProps.forEach((row, index) => {
    if (String(shown.values[index]) !== String(row.value)) {
      fail(`weekly property ${row.label} is "${shown.values[index]}"`);
    }
  });
  if (!shown.values.includes("五栏 Segmented · 无 TOC")) fail("C-W1 shell property missing");
  const tabs = tabLabels(firstBlock(html.weekly, 'class="page-tabs', "</div>"));
  if (tabs.join("|") !== "要闻|政治金融|顶尖论文|GitHub|金融决策") fail(`S6 tabs ${tabs.join("|")}`);
  if (tabs[tabs.length - 1] !== "金融决策") fail("S6 金融决策 is not the last tab");
  const bar = firstBlock(html.weekly, 'class="page-tabs', "</div>");
  if (!/aria-controls="panel-news"[^>]*aria-selected="true"/.test(bar)) fail("S6 default tab is not 要闻");
  if (!/aria-controls="panel-decisions"[^>]*aria-selected="false"/.test(bar)) fail("S6 金融决策 is selected by default");
  const decisionsOpen = openingTag(html.weekly, "panel-decisions");
  if (!decisionsOpen.includes(" hidden") || !decisionsOpen.includes("inert")) fail("S6 金融决策 is in the default reading flow");
  if (openingTag(html.weekly, "panel-news").includes(" hidden")) fail("S6 要闻 panel is hidden");
  const newsPanel = sliceBetween(html.weekly, 'id="panel-news"', 'id="panel-papers"');
  if (!newsPanel.includes("AI 产品 / 科技") || !newsPanel.includes("AI 安全") || !newsPanel.includes("其他安全 / 加密")) {
    fail("S6 weekly news groups missing");
  }
  if (!newsPanel.includes('class="brf-link-cards"')) fail("S6 要闻 is missing LinkCards");
  for (const item of weeklyJson.news) {
    const count = newsPanel.split(item.why).length - 1;
    if (item.why && count !== 1) fail(`S6 ${item.id} why appears ${count} times`);
  }
  const decisionHtml = html.weekly.match(/<article class="decision"[\s\S]*?<\/article>/g) || [];
  if (decisionHtml.length !== weeklyJson.decisions.length) fail(`C-W2 decision count ${decisionHtml.length}`);
  const decisionKeys = ["事实", "判断", "为何重要", "架构·风险影响", "控制域", "成本权衡"];
  decisionHtml.forEach((card, index) => {
    const labels = [...card.matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1]);
    if (labels.join("|") !== decisionKeys.join("|")) fail(`C-W2 decision ${index + 1} keys ${labels.join("|")}`);
    if (!card.includes(`id="decision-${index + 1}"`)) fail(`C-W2 missing decision-${index + 1}`);
  });
  const finance = sliceBetween(html.weekly, 'id="panel-decisions"', 'class="page-tabs page-tabs-bottom');
  if (!finance.includes('data-tone="danger"')) fail("S6 finance callout is not danger");
  if (!finance.includes('class="brf-steps"')) fail("S6 steps missing");
  const stepItems = finance.match(/<li class="brf-step">[\s\S]*?<\/li>/g) || [];
  if (stepItems.length !== weeklySteps.length) fail(`S6 step count ${stepItems.length}`);
  if (!stepItems.some((step) => step.includes("P0 ·")) || !stepItems.some((step) => step.includes("P2 ·"))) {
    fail("S6 steps do not span P0–P2");
  }
  for (const line of finalJudgments(weeklyJson.decisions)) {
    if (!finance.includes(line)) fail("S6 最终判断 dropped a judgment line");
  }
  const weeklyRising = sliceBetween(html.weekly, 'id="gh-rising"', 'id="gh-newcomers"');
  const weeklyNew = sliceBetween(html.weekly, 'id="gh-newcomers"', 'id="gh-summary"');
  if (weeklyJson.github.rising.length) {
    assertGithubRows("S6 rising", weeklyRising, weeklyJson.github.rising.slice(0, 5), "gh-rising");
  }
  if (weeklyJson.github.newcomers.length) {
    assertGithubRows("S6 newcomers", weeklyNew, weeklyJson.github.newcomers.slice(0, 5), "gh-newcomer");
  }
  if (!html.weekly.includes('class="brf-rows"') || !html.weekly.includes('class="brf-status"') || !html.weekly.includes('class="brf-steps"')) {
    fail("weekly is missing Rows, Status, or Steps");
  }
  assertChrome("weekly", html.weekly);
}

function assertChrome(name, text) {
  const headerEnd = text.indexOf("</header>");
  const header = headerEnd < 0 ? "" : text.slice(0, headerEnd);
  if (!header) fail(`${name} is missing the chrome header`);
  if (header.includes('class="nav"') || header.includes(">Daily<") || header.includes(">Weekly<")) {
    fail(`${name} chrome still has a Daily/Weekly nav`);
  }
  if (!header.includes('class="brand-lockup"') || !header.includes('class="seg theme-switch"')) {
    fail(`${name} chrome dropped the lockup or theme switch`);
  }
}


if (!cssSource.includes("scroll-margin-top: calc(var(--s-7) + var(--s-3))")) {
  fail("section targets are missing scroll-margin-top");
}
if (!cssSource.includes("content: attr(data-label)") || !cssSource.includes("@media (max-width: 640px)")) {
  fail("mobile tables are missing the card stack");
}
if (!cssSource.includes("overflow-x: clip")) fail("page is missing horizontal clip");
if (!/\.cell-short\s*\{[^}]*text-overflow:\s*ellipsis/.test(cssSource)) {
  fail("short columns are missing single-line ellipsis");
}
if (!/\.cell-link\s*\{[^}]*text-overflow:\s*ellipsis/.test(cssSource)) {
  fail("table links are missing single-line ellipsis");
}
if (!baseSource.includes('a[href^="#"]') || !baseSource.includes("revealTarget") || !baseSource.includes("selectTab")) {
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
const globalHover = cssSource.match(/(?:^|[{}]|\n)\s*a:hover\s*\{[^}]*\}/);
if (!globalHover) fail("missing the global a:hover rule");
if (globalHover && /background/i.test(globalHover[0])) {
  fail("global a:hover still paints a background");
}
if (!/\.hit-row\s*\{[^}]*padding-inline:\s*var\(--inset-row\)/.test(cssSource)) {
  fail("hit-row is missing padding-inline --inset-row");
}
if (!/\.hit-row\s*\{[^}]*padding-block:\s*var\(--s-2\)/.test(cssSource)) {
  fail("hit-row is missing padding-block --s-2");
}
if (!/\.entry\s*\{[^}]*padding-inline:\s*var\(--inset-row\)/.test(cssSource)) {
  fail(".entry is missing padding-inline --inset-row");
}
if (!/\.hot-list a\s*\{[^}]*padding-inline:\s*var\(--inset-row\)/.test(cssSource)) {
  fail("hot rows are missing padding-inline --inset-row");
}
if (!cssSource.includes("--pad-x: var(--s-5)") || !cssSource.includes("--inset-row: var(--s-4)") || !cssSource.includes("--inset-card: var(--s-5)")) {
  fail("B1 desktop pad-x / inset tokens are missing");
}
if (!narrow.includes("--pad-x: var(--s-4)") || !narrow.includes("--inset-card: var(--s-4)")) {
  fail("B1/B3 narrow pad must be 16px");
}
if (cssSource.includes("--pad-x: var(--s-3)")) fail("pad-x must not fall to 12px");
if (!/\.detail-card,\s*\n\.gh-card,\s*\n\.paper-card\s*\{[^}]*padding:\s*var\(--inset-card\)/.test(cssSource)) {
  fail("B3 detail card is missing inset-card");
}
if (!/\.decision\s*\{[^}]*padding-inline:\s*var\(--inset-row\)/.test(cssSource)) {
  fail("B3 decision is missing horizontal inset");
}
if (!cssSource.includes("--t3-size: 15px") || !cssSource.includes("--t3-lh: 1.65") || !cssSource.includes("--t3-size: 16px")) {
  fail("B4 T3 ladder missing");
}
if (!cssSource.includes("--t1-size: 26px") || !cssSource.includes("--t1-size: 30px") || !cssSource.includes("--t1-weight: 650")) {
  fail("B4 T1 ladder missing");
}
if (!cssSource.includes("--t2-size: 20px") || !cssSource.includes("--t2-size: 22px") || !cssSource.includes("--t2-weight: 600")) {
  fail("B4 T2 ladder missing");
}
if (!cssSource.includes("--t4-size: 14px") || !cssSource.includes("--t5-size: 13px") || !cssSource.includes("--t5-weight: 560")) {
  fail("B4 T4/T5 ladder missing");
}
if (!cssSource.includes("--t6-size: 11px") || !cssSource.includes("--t6-weight: 500") || !cssSource.includes("--t6-lh: 1.35")) {
  fail("B4 T6 ladder missing");
}
if (!/\.decision > h3\s*\{[^}]*font-size:\s*var\(--t2-size\)/.test(cssSource)) {
  fail("B4 decision heading must stay above body size");
}
if (!/\.detail-card \.card-title[\s\S]*?font-weight:\s*600/.test(cssSource)) {
  fail("B4 card title must be weight 600");
}
for (const name of ["home", "daily", "weekly"]) {
  const text = html[name];
  if (!text) continue;
  if (!text.includes('class="brand-lockup"')) fail(`${name} is missing the Home lockup`);
  if (!text.includes('class="root-link" href="https://yurkingw.github.io/"')) {
    fail(`${name} Home does not point at the site root`);
  }
  if (!text.includes(">Home</a>")) fail(`${name} is missing the Home label`);
  if (!text.includes('class="brand" href="/briefings/"')) fail(`${name} Briefings mark is missing`);
}
if (!fs.existsSync(path.join(root, "_site/fonts/inter-latin-wght-normal.woff2"))) {
  fail("missing self-hosted Inter latin font");
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("public check ok");
console.log(Object.values(pages).join("\n"));
