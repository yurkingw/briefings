import assert from "node:assert/strict";
import test from "node:test";
import { contentHash, normalizeBriefing } from "../../lib/publish/normalize.js";
import { dailyObject, dailyRaw, weeklyRaw } from "./fixtures.mjs";

test("daily normalization keeps extensions and does not invent github fields", () => {
  const normalized = normalizeBriefing(dailyRaw());
  assert.equal(normalized.schema, "qianji.briefing.daily.v1");
  assert.equal(normalized.period, "2026-11-10");
  assert.equal(normalized.object.metrics.news_noon, 0);
  assert.equal(normalized.object.metrics.news_morning, 1);
  assert.equal(normalized.object.polfin[0].wave, "晨间");
  assert.equal(normalized.object.github.rising[0].age_h, null);
  assert.equal(normalized.object.github.newcomers[0].gained, null);
  assert.equal(Object.hasOwn(normalized.object.github.rising[0], "url"), false);
  assert.equal(contentHash(normalized.object), normalized.contentHash);
  const again = normalizeBriefing(dailyRaw());
  assert.equal(again.contentHash, normalized.contentHash);
  assert.equal(again.snapshot.equals(normalized.snapshot), true);
});

test("content hash ignores updated_at and markdown", () => {
  const first = normalizeBriefing(dailyRaw());
  const second = normalizeBriefing(dailyRaw({ updated_at: "2026-11-10T12:30:00+08:00" }));
  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.snapshotSha256, second.snapshotSha256);
  assert.equal(first.contentHash.includes("markdown"), false);
});

test("weekly shape keeps live extensions and omits absent newcomer fields", () => {
  const normalized = normalizeBriefing(weeklyRaw());
  assert.equal(normalized.period, "2026-W46");
  assert.equal(normalized.object.window.note, "合成窗");
  assert.equal(normalized.object.gaps[0], "合成缺口");
  assert.equal(normalized.object.news_digest, "合成摘要");
  assert.equal(normalized.object.metrics.news_featured, 1);
  assert.equal(Object.hasOwn(normalized.object.metrics, "home_related"), false);
  const newcomer = normalized.object.github.newcomers[0];
  assert.equal(Object.hasOwn(newcomer, "age_h"), false);
  assert.equal(Object.hasOwn(newcomer, "slogan"), false);
  assert.equal(Object.hasOwn(newcomer, "license"), false);
  assert.equal(newcomer.gained, null);
  assert.equal(normalized.object.news[0].wave, undefined);
});

test("synthetic exact-impression text is stripped and then stable", () => {
  const raw = dailyRaw();
  const parsed = JSON.parse(raw.toString("utf8"));
  parsed.news[0].facts = "约 1.2 万曝光";
  const normalized = normalizeBriefing(Buffer.from(JSON.stringify(parsed)));
  const facts = normalized.object.news[0].facts;
  assert.equal(facts.includes("万曝光"), false);
  assert.equal(facts.includes("（精确曝光已省略）"), true);
  assert.equal(normalizeBriefing(Buffer.from(JSON.stringify(parsed))).contentHash, normalized.contentHash);
});

test("forbidden text that survives stripping rejects the export", () => {
  const parsed = dailyObject();
  parsed.news[0].facts = "marker folder_id remains";
  assert.throws(
    () => normalizeBriefing(Buffer.from(JSON.stringify(parsed))),
    (error) => error.exit === 10 && error.result === "forbidden",
  );
});

test("sample exports and bad metrics are rejected", () => {
  assert.throws(
    () => normalizeBriefing(dailyRaw({ sample: true })),
    (error) => error.exit === 10 && error.result === "sample_refused",
  );
  const bad = dailyObject();
  bad.metrics.home_related = "12";
  assert.throws(
    () => normalizeBriefing(Buffer.from(JSON.stringify(bad))),
    (error) => error.exit === 10,
  );
});

test("weekly newcomer without what is rejected and missing age_h is not", () => {
  const parsed = JSON.parse(weeklyRaw().toString("utf8"));
  delete parsed.github.newcomers[0].what;
  assert.throws(() => normalizeBriefing(Buffer.from(JSON.stringify(parsed))), (error) => error.exit === 10);
});

test("a workspace-like token is removed and not required as a fixture path", () => {
  const parsed = dailyObject();
  parsed.summary = `prefix ${["/", "workspace", "/synthetic"].join("")} suffix`;
  const normalized = normalizeBriefing(Buffer.from(JSON.stringify(parsed)));
  assert.equal(normalized.snapshot.toString("utf8").includes(["/", "workspace"].join("")), false);
});
