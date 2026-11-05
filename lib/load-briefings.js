import fs from "node:fs";
import path from "node:path";
import { findForbidden, stripValue } from "./strip-public.js";

const DAILY_SCHEMA = "qianji.briefing.daily.v1";
const WEEKLY_SCHEMA = "qianji.briefing.weekly.v1";

function fail(file, message) {
  throw new Error(`${path.basename(file)}: ${message}`);
}

function readJson(file) {
  const raw = fs.readFileSync(file, "utf8");
  const hits = findForbidden(raw);
  if (hits.length) {
    fail(file, `forbidden public text (${hits.join(", ")}). Strip it before commit.`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    fail(file, `invalid JSON (${error.message})`);
  }
  return stripValue(data);
}

function requireKeys(data, keys, file) {
  for (const key of keys) {
    if (data[key] == null || data[key] === "") fail(file, `missing ${key}`);
  }
}

function slugUrl(owner, repo) {
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return `https://github.com/${owner}/${repo}`;
}

function decorateRepo(item, file, { requireAge = false } = {}) {
  if (!item || typeof item !== "object") fail(file, "github entry is not an object");
  requireKeys(item, ["rank", "repo", "owner"], file);
  if (requireAge && (item.age_h == null || item.age_h === "")) {
    fail(file, `${item.owner}/${item.repo} missing age_h`);
  }
  if (!item.url) {
    const url = slugUrl(String(item.owner), String(item.repo));
    if (!url) fail(file, `${item.owner}/${item.repo} missing a public url`);
    item.url = url;
  }
  return item;
}

function assertNews(item, file, { daily }) {
  requireKeys(item, ["id", "domain", "title"], file);
  if (daily) {
    if (typeof item.finsec !== "boolean") fail(file, `news ${item.id} finsec must be boolean`);
    if (typeof item.hard_gate !== "boolean") fail(file, `news ${item.id} hard_gate must be boolean`);
  }
  if (item.links != null && !Array.isArray(item.links)) fail(file, `news ${item.id} links must be an array`);
}

function assertPapers(item, file) {
  requireKeys(item, ["short", "url"], file);
}

function assertDaily(data, file) {
  if (data.schema !== DAILY_SCHEMA) fail(file, `schema must be ${DAILY_SCHEMA}`);
  requireKeys(data, ["date", "timezone", "updated_at", "wave", "summary", "metrics", "news", "papers", "github", "sources"], file);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) fail(file, "date must be YYYY-MM-DD");
  if (path.basename(file, ".json") !== data.date) fail(file, "filename must match date");
  const metrics = data.metrics;
  for (const key of ["news", "finsec", "papers", "gh_rising", "gh_newcomers", "home_related"]) {
    if (metrics[key] == null) fail(file, `metrics.${key} missing`);
  }
  if (typeof metrics.home_related !== "string" || !/^\d+\/\d+$/.test(metrics.home_related)) {
    fail(file, "metrics.home_related must be a/b, not an impression count");
  }
  if (!Array.isArray(data.news) || !Array.isArray(data.papers) || !Array.isArray(data.sources)) {
    fail(file, "news, papers, and sources must be arrays");
  }
  for (const item of data.news) assertNews(item, file, { daily: true });
  for (const item of data.papers) assertPapers(item, file);
  requireKeys(data.github, ["rising", "newcomers", "meta"], file);
  data.github.rising = data.github.rising.map((item) => decorateRepo(item, file));
  data.github.newcomers = data.github.newcomers.map((item) => decorateRepo(item, file, { requireAge: true }));
  if (data.github.meta.archive == null) fail(file, "github.meta.archive missing");
}

function assertWeekly(data, file) {
  if (data.schema !== WEEKLY_SCHEMA) fail(file, `schema must be ${WEEKLY_SCHEMA}`);
  requireKeys(data, ["week", "timezone", "updated_at", "summary", "metrics", "decisions", "news", "papers", "github", "sources"], file);
  if (!/^\d{4}-W\d{2}$/.test(data.week)) fail(file, "week must be YYYY-Www");
  if (path.basename(file, ".json") !== data.week) fail(file, "filename must match week");
  if (!Array.isArray(data.decisions) || data.decisions.length === 0) fail(file, "decisions must be a non-empty array");
  for (const card of data.decisions) {
    requireKeys(card, ["title", "happened", "why", "arch_impact"], file);
  }
  if (!Array.isArray(data.news) || !Array.isArray(data.papers) || !Array.isArray(data.sources)) {
    fail(file, "news, papers, and sources must be arrays");
  }
  for (const item of data.news) assertNews(item, file, { daily: false });
  for (const item of data.papers) assertPapers(item, file);
  requireKeys(data.github, ["rising", "newcomers", "meta"], file);
  data.github.rising = data.github.rising.map((item) => decorateRepo(item, file));
  data.github.newcomers = data.github.newcomers.map((item) => decorateRepo(item, file, { requireAge: true }));
  if (data.github.meta.archive == null && data.github.meta.note == null) {
    fail(file, "github.meta needs archive or a public note");
  }
}

function loadDir(dir, kind) {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.map((name) => {
    const file = path.join(dir, name);
    const data = readJson(file);
    if (kind === "daily") assertDaily(data, file);
    else assertWeekly(data, file);
    return data;
  });
}

export function loadBriefings(contentDir) {
  const daily = loadDir(path.join(contentDir, "daily"), "daily").sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const weekly = loadDir(path.join(contentDir, "weekly"), "weekly").sort((a, b) =>
    b.week.localeCompare(a.week),
  );
  return { daily, weekly };
}
