import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { stageReady, verifyReady } from "../../lib/publish/ready.js";
import { dailyRaw, tempRoot, weeklyRaw } from "./fixtures.mjs";

function readyPath(root, type, period) {
  return path.join(root, "ready", `${type}-${period}.json`);
}

test("ready is renamed last and binds both hashes", () => {
  const root = tempRoot();
  const staged = stageReady(root, dailyRaw());
  const ready = JSON.parse(fs.readFileSync(staged.readyPath, "utf8"));
  assert.deepEqual(Object.keys(ready).sort(), [
    "content_hash",
    "period",
    "raw",
    "raw_sha256",
    "ready_schema",
    "schema",
    "snapshot",
    "snapshot_sha256",
    "updated_at",
  ]);
  assert.equal(ready.ready_schema, "qianji.briefing.export-ready.v1");
  assert.equal(path.isAbsolute(ready.snapshot), false);
  assert.equal(ready.snapshot.includes(".."), false);
  const verified = verifyReady(staged.readyPath);
  assert.equal(verified.contentHash, ready.content_hash);
  assert.equal(verified.snapshotSha256, ready.snapshot_sha256);
  assert.equal(verified.rawSha256, ready.raw_sha256);
  assert.equal(verified.schema, ready.schema);
  assert.equal(verified.period, ready.period);
  assert.equal(verified.updatedAt, ready.updated_at);
});

test("crashes before the ready rename leave no consumable ready", () => {
  for (const crash of ["before-raw-rename", "before-norm-rename", "before-ready-rename"]) {
    const root = tempRoot();
    const staged = stageReady(root, dailyRaw(), { crash });
    assert.equal(staged.readyPath, null);
    assert.equal(fs.existsSync(readyPath(root, "daily", "2026-11-10")), false);
    assert.throws(() => verifyReady(readyPath(root, "daily", "2026-11-10")), (error) => error.exit === 11);
  }
});

test("a bare briefing is not a ready snapshot", () => {
  const root = tempRoot();
  const jsonPath = path.join(root, "2026-11-10.json");
  fs.writeFileSync(jsonPath, dailyRaw());
  assert.throws(() => verifyReady(jsonPath), (error) => error.exit === 11 && error.result === "ready_mismatch");
});

test("snapshot tamper and hash disagreement fail closed", () => {
  const root = tempRoot();
  const staged = stageReady(root, weeklyRaw());
  const verified = verifyReady(staged.readyPath);
  const normPath = path.join(verified.root, verified.ready.snapshot);
  const bytes = fs.readFileSync(normPath);
  bytes[bytes.length - 3] = bytes[bytes.length - 3] === 65 ? 66 : 65;
  fs.writeFileSync(normPath, bytes);
  assert.throws(() => verifyReady(staged.readyPath), (error) => error.exit === 11);

  const root2 = tempRoot();
  const staged2 = stageReady(root2, weeklyRaw());
  const readyFile = staged2.readyPath;
  const ready = JSON.parse(fs.readFileSync(readyFile, "utf8"));
  ready.content_hash = "f".repeat(64);
  fs.writeFileSync(readyFile, JSON.stringify(ready));
  assert.throws(() => verifyReady(readyFile), (error) => error.exit === 11);
});

test("ready paths cannot escape the export root", () => {
  const root = tempRoot();
  const staged = stageReady(root, dailyRaw());
  const ready = JSON.parse(fs.readFileSync(staged.readyPath, "utf8"));
  ready.snapshot = "../../outside.json";
  fs.writeFileSync(staged.readyPath, JSON.stringify(ready));
  assert.throws(() => verifyReady(staged.readyPath), (error) => error.exit === 11);
});

test("sibling markdown does not change the ready binding", () => {
  const root = tempRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "note.md"), "markdown must not affect the hash");
  const staged = stageReady(root, dailyRaw());
  const verified = verifyReady(staged.readyPath);
  assert.equal(verified.contentHash, staged.contentHash);
});
