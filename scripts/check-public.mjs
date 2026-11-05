import fs from "node:fs";
import path from "node:path";
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

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("public check ok");
console.log(Object.values(pages).join("\n"));
