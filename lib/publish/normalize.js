import { createHash } from "node:crypto";
import { findForbidden, stripValue } from "../strip-public.js";
import { fail } from "./errors.js";
import { parseUpdatedAt } from "./timestamp.js";

const DAILY_SCHEMA = "qianji.briefing.daily.v1";
const WEEKLY_SCHEMA = "qianji.briefing.weekly.v1";
const WEEK = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

export function contentHash(object) {
  const sorted = sortValue(object);
  delete sorted.updated_at;
  return sha256(JSON.stringify(sorted));
}

function snapshotBytes(object) {
  return Buffer.from(`${JSON.stringify(sortValue(object), null, 2)}\n`);
}

function requireFields(object, fields) {
  for (const field of fields) {
    if (object?.[field] == null || object[field] === "") throw fail(10, "invalid");
  }
}

function requireArray(value) {
  if (!Array.isArray(value)) throw fail(10, "invalid");
}

function assertRepo(item, { weekly, board }) {
  if (!item || typeof item !== "object") throw fail(10, "invalid");
  requireFields(item, ["rank", "repo", "owner"]);
  if (!weekly) return;
  if (board === "rising") {
    requireFields(item, ["what", "why"]);
    const gained = item.gained != null && item.gained !== "";
    const approx = item.gained_week_approx != null && item.gained_week_approx !== "";
    if (!gained && !approx) throw fail(10, "invalid");
    return;
  }
  requireFields(item, ["what", "why"]);
}

function assertNews(item, { weekly }) {
  if (!item || typeof item !== "object") throw fail(10, "invalid");
  requireFields(item, ["id", "domain", "title"]);
  if (typeof item.finsec !== "boolean" || typeof item.hard_gate !== "boolean") throw fail(10, "invalid");
  if (weekly) {
    requireFields(item, ["background", "facts", "why"]);
    if (typeof item.detail !== "boolean") throw fail(10, "invalid");
  }
}

function assertPolfin(data, { weekly }) {
  if (data.polfin == null) return;
  requireArray(data.polfin);
  const newsIds = new Set((data.news || []).map((item) => String(item.id)));
  for (const item of data.polfin) {
    requireFields(item, ["id", "title"]);
    if (newsIds.has(String(item.id))) throw fail(10, "invalid");
    if (!weekly && item.wave !== "晨间" && item.wave !== "午间") throw fail(10, "invalid");
  }
}

function assertCommon(data) {
  if (data.sample === true) throw fail(10, "sample_refused");
  if (data.timezone !== "Asia/Shanghai") throw fail(10, "invalid");
  requireFields(data, ["summary", "updated_at"]);
  requireArray(data.news);
  requireArray(data.papers);
  requireArray(data.sources);
  if (!data.github || typeof data.github !== "object") throw fail(10, "invalid");
  requireArray(data.github.rising);
  requireArray(data.github.newcomers);
  if (!data.metrics || typeof data.metrics !== "object") throw fail(10, "invalid");
  for (const paper of data.papers) requireFields(paper, ["short", "url"]);
}

function assertDaily(data) {
  if (data.schema !== DAILY_SCHEMA) throw fail(10, "invalid");
  assertCommon(data);
  requireFields(data, ["date", "wave"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw fail(10, "invalid");
  parseUpdatedAt(data.updated_at);
  for (const key of ["news", "finsec", "papers", "gh_rising", "gh_newcomers"]) {
    if (typeof data.metrics[key] !== "number") throw fail(10, "invalid");
  }
  if (typeof data.metrics.home_related !== "string" || !/^\d+\/\d+$/.test(data.metrics.home_related)) {
    throw fail(10, "invalid");
  }
  for (const item of data.news) assertNews(item, { weekly: false });
  for (const item of data.github.rising) assertRepo(item, { weekly: false, board: "rising" });
  for (const item of data.github.newcomers) assertRepo(item, { weekly: false, board: "newcomers" });
  if (data.github.meta?.archive == null) throw fail(10, "invalid");
  assertPolfin(data, { weekly: false });
  return { type: "daily", period: data.date };
}

function assertWeekly(data) {
  if (data.schema !== WEEKLY_SCHEMA) throw fail(10, "invalid");
  assertCommon(data);
  requireFields(data, ["week"]);
  if (!WEEK.test(data.week)) throw fail(10, "invalid");
  parseUpdatedAt(data.updated_at);
  requireArray(data.decisions);
  if (data.decisions.length === 0) throw fail(10, "invalid");
  for (const card of data.decisions) requireFields(card, ["title", "happened", "why", "arch_impact"]);
  for (const item of data.news) assertNews(item, { weekly: true });
  for (const item of data.github.rising) assertRepo(item, { weekly: true, board: "rising" });
  for (const item of data.github.newcomers) assertRepo(item, { weekly: true, board: "newcomers" });
  if (data.github.meta?.archive == null && data.github.meta?.note == null) throw fail(10, "invalid");
  assertPolfin(data, { weekly: true });
  return { type: "weekly", period: data.week };
}

export function normalizeBriefing(rawBytes) {
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(String(rawBytes));
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw fail(10, "bad_json");
  }
  const object = stripValue(parsed);
  const identity = object.schema === WEEKLY_SCHEMA ? assertWeekly(object) : assertDaily(object);
  const snapshot = snapshotBytes(object);
  const forbidden = findForbidden(snapshot.toString("utf8"));
  if (forbidden.length) throw fail(10, "forbidden");
  const stamp = parseUpdatedAt(object.updated_at);
  return {
    object,
    snapshot,
    snapshotBytes: snapshot,
    contentHash: contentHash(object),
    rawSha256: sha256(raw),
    snapshotSha256: sha256(snapshot),
    schema: object.schema,
    type: identity.type,
    period: identity.period,
    updatedAt: stamp.raw,
    updatedAtMs: stamp.instantMs,
  };
}
