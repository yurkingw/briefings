import fs from "node:fs";
import path from "node:path";
import { excerpt } from "../lib/excerpt.js";
import { loadBriefings } from "../lib/load-briefings.js";
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

const briefings = loadBriefings(path.join(root, "content"));
const latestDaily = briefings.daily[0];
const latestWeekly = briefings.weekly[0];
if (!latestDaily || !latestWeekly) fail("sample daily and weekly JSON must both load");
const latestHtml = sliceBetween(html.home, 'id="latest"', 'id="daily"');
if (!latestHtml) fail("home is missing the Latest section before the archive");
for (const [label, href, blurb] of [
  ["Latest daily", `/briefings/daily/${latestDaily.date}/`, excerpt(latestDaily.summary, 150)],
  ["Latest weekly", `/briefings/weekly/${latestWeekly.week}/`, excerpt(latestWeekly.summary, 150)],
]) {
  const open = `<a class="entry" href="${href}">`;
  const start = latestHtml.indexOf(open);
  const end = start < 0 ? -1 : latestHtml.indexOf("</a>", start);
  const row = start < 0 || end < 0 ? "" : latestHtml.slice(start, end);
  if (!row) fail(`latest row is missing or not a whole-row link: ${label}`);
  else {
    if (!row.includes(label)) fail(`latest row label missing: ${label}`);
    if (!row.includes(htmlEscape(blurb))) fail(`latest row is missing the conclusion excerpt: ${label}`);
  }
}
if (html.home.indexOf('id="latest"') > html.home.indexOf('id="daily"')) {
  fail("Latest must sit above the Daily archive");
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
  assertOrder("daily", html.daily, [">Conclusion<", ">Metrics<", ">News<"]);
  const metrics = sliceBetween(html.daily, ">Metrics<", ">News<");
  if (metrics.includes("<table") || metrics.includes(">Metric<")) fail("daily metrics is still a metric table");
  if (!metrics.includes("News 16")) fail("daily metrics line missing");
  if (!html.daily.includes('class="conclusion"')) fail("daily conclusion block missing");
  if (!html.daily.includes('aria-current="page">Daily')) fail("daily page does not mark the Daily nav");
}
if (html.weekly) {
  assertOrder("weekly", html.weekly, [">Conclusion<", ">Metrics<", ">Decisions<", ">News<"]);
  const metrics = sliceBetween(html.weekly, ">Metrics<", ">Decisions<");
  if (metrics.includes("<table") || metrics.includes(">Metric<")) fail("weekly metrics is still a metric table");
  if (!html.weekly.includes('class="decision"')) fail("weekly decisions are missing the hairline article");
  if (!html.weekly.includes('aria-current="page">Weekly')) fail("weekly page does not mark the Weekly nav");
}
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
