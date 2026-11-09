import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { publishReadyFile } from "../../lib/publish/cas.js";
import { normalizeBriefing } from "../../lib/publish/normalize.js";
import { stageReady } from "../../lib/publish/ready.js";
import { withLock } from "../../lib/publish/lock.js";
import { dailyObject, dailyRaw, tempRoot } from "./fixtures.mjs";

function memoryTransport(files = new Map()) {
  let commit = files.size ? "base-commit" : "base-commit";
  let tree = "base-tree";
  const calls = [];
  return {
    enabled: true,
    calls,
    files,
    snapshot() {
      return { commit, tree, files: new Map(files) };
    },
    async fetchState({ path: filePath }) {
      calls.push({ op: "fetch", path: filePath, commit });
      const bytes = files.get(filePath) ?? null;
      return { commitSha: commit, treeSha: tree, file: bytes ? { bytes } : null };
    },
    async publish({ baseCommitSha, baseTreeSha, path: filePath, content }) {
      calls.push({ op: "publish", baseCommitSha, baseTreeSha, path: filePath });
      if (baseCommitSha !== commit || baseTreeSha !== tree) {
        throw Object.assign(new Error("non-ff"), { code: "rejected_non_ff" });
      }
      if (this.failMode === "network-before") {
        this.failMode = this.after ?? "ok";
        throw Object.assign(new Error("network"), { code: "network" });
      }
      if (this.failMode === "shift-once") {
        this.failMode = "ok";
        files.set("content/other/keep.json", Buffer.from("keep-v2\n"));
        commit = "moved-commit";
        tree = "moved-tree";
        throw Object.assign(new Error("non-ff"), { code: "rejected_non_ff" });
      }
      files.set(filePath, Buffer.from(content));
      commit = `commit-${calls.filter((call) => call.op === "publish").length}`;
      tree = `tree-${commit}`;
      if (this.failMode === "lost-after") {
        this.failMode = "ok";
        throw Object.assign(new Error("lost"), { code: "lost_response" });
      }
      return { commitSha: commit };
    },
  };
}

async function publishRaw(raw, transport, receiptDir = tempRoot()) {
  const root = tempRoot();
  const staged = stageReady(root, raw);
  const outcome = await publishReadyFile({
    readyPath: staged.readyPath,
    transport,
    receiptDir,
    lockTimeoutMs: 1000,
  });
  return { outcome, transport, receiptDir, staged };
}

test("adapter disabled does not fetch or publish", async () => {
  const transport = { enabled: false, async fetchState() { throw new Error("fetched"); }, async publish() { throw new Error("published"); } };
  const receiptDir = tempRoot();
  const staged = stageReady(tempRoot(), dailyRaw());
  const outcome = await publishReadyFile({
    readyPath: staged.readyPath,
    transport,
    receiptDir,
  });
  assert.equal(outcome.exit, 50);
  assert.equal(outcome.body.result, "adapter_disabled");
  assert.equal(fs.existsSync(path.join(receiptDir, "success.json")), false);
  assert.equal(fs.existsSync(path.join(receiptDir, "pending.json")), false);
});

test("publishes a missing path and dedupes the same ready", async () => {
  const transport = memoryTransport();
  const first = await publishRaw(dailyRaw(), transport);
  assert.equal(first.outcome.exit, 0);
  assert.equal(first.outcome.body.result, "published");
  const success = fs.readFileSync(path.join(first.receiptDir, "success.json"));
  const second = await publishReadyFile({
    readyPath: first.staged.readyPath,
    transport,
    receiptDir: first.receiptDir,
    lockTimeoutMs: 1000,
  });
  assert.equal(second.exit, 0);
  assert.equal(second.body.result, "noop");
  assert.equal(transport.calls.filter((call) => call.op === "publish").length, 1);
  assert.equal(fs.readFileSync(path.join(first.receiptDir, "success.json")).equals(success), true);
});

test("same instant different offset is the same version", async () => {
  const original = normalizeBriefing(dailyRaw());
  const shifted = dailyObject({ updated_at: "2026-11-10T00:00:00+00:00" });
  const remote = normalizeBriefing(Buffer.from(JSON.stringify(shifted)));
  assert.equal(original.contentHash, remote.contentHash);
  const transport = memoryTransport(new Map([["content/daily/2026-11-10.json", remote.snapshot]]));
  const published = await publishRaw(dailyRaw(), transport);
  assert.equal(published.outcome.body.result, "noop");
  assert.equal(transport.calls.some((call) => call.op === "publish"), false);
});

test("same version with different content conflicts and keeps the success receipt", async () => {
  const transport = memoryTransport();
  const first = await publishRaw(dailyRaw(), transport);
  const success = fs.readFileSync(path.join(first.receiptDir, "success.json"));
  const parsed = dailyObject();
  parsed.summary = "另一份正文";
  const second = await publishRaw(Buffer.from(JSON.stringify(parsed)), transport, first.receiptDir);
  assert.equal(second.outcome.exit, 20);
  assert.equal(second.outcome.body.result, "conflict");
  assert.equal(fs.readFileSync(path.join(first.receiptDir, "success.json")).equals(success), true);
  const pending = JSON.parse(fs.readFileSync(path.join(first.receiptDir, "pending.json"), "utf8"));
  assert.equal(pending.status, "pending");
  assert.equal(pending.exit, 20);
});

test("older different content is stale and newer same content publishes the stamp", async () => {
  const transport = memoryTransport();
  const newer = dailyObject({ updated_at: "2026-11-10T12:30:00+08:00", summary: "午间合成" });
  await publishRaw(Buffer.from(JSON.stringify(newer)), transport);
  const older = await publishRaw(dailyRaw(), transport);
  assert.equal(older.outcome.exit, 21);
  assert.equal(older.outcome.body.result, "stale");
  assert.equal(transport.calls.filter((call) => call.op === "publish").length, 1);

  const bumpTransport = memoryTransport();
  const old = await publishRaw(dailyRaw(), bumpTransport);
  const before = JSON.parse(fs.readFileSync(path.join(old.receiptDir, "success.json"), "utf8"));
  const bumped = await publishRaw(
    dailyRaw({ updated_at: "2026-11-10T12:30:00+08:00" }),
    bumpTransport,
    old.receiptDir,
  );
  assert.equal(bumped.outcome.exit, 0);
  assert.equal(bumped.outcome.body.result, "published");
  const after = JSON.parse(fs.readFileSync(path.join(old.receiptDir, "success.json"), "utf8"));
  assert.equal(after.updated_at, "2026-11-10T12:30:00+08:00");
  assert.notEqual(after.updated_at, before.updated_at);
  assert.equal(after.content_hash, before.content_hash);
});

test("a moved base is reread at most three times and other files stay", async () => {
  const transport = memoryTransport(new Map([["content/other/keep.json", Buffer.from("keep-v1\n")]]));
  transport.failMode = "shift-once";
  const published = await publishRaw(dailyRaw(), transport);
  assert.equal(published.outcome.exit, 0);
  assert.equal(transport.files.get("content/other/keep.json").toString("utf8"), "keep-v2\n");
  assert.equal(transport.calls.filter((call) => call.op === "publish").length, 2);

  const exhausted = memoryTransport();
  exhausted.publish = async () => {
    throw Object.assign(new Error("down"), { code: "network" });
  };
  const failed = await publishRaw(dailyRaw(), exhausted);
  assert.equal(failed.outcome.exit, 40);
  assert.equal(failed.outcome.body.attempts, 3);
  assert.equal(fs.existsSync(path.join(failed.receiptDir, "success.json")), false);
});

test("a lost response retries once and does not write a second copy", async () => {
  const transport = memoryTransport();
  transport.failMode = "lost-after";
  const published = await publishRaw(dailyRaw(), transport);
  assert.equal(published.outcome.exit, 0);
  assert.equal(transport.calls.filter((call) => call.op === "publish").length, 1);
  const success = JSON.parse(fs.readFileSync(path.join(published.receiptDir, "success.json"), "utf8"));
  assert.equal(success.status, "success");
  assert.equal(success.content_hash, published.staged.contentHash);
});

test("lock timeout leaves an existing success receipt untouched", async () => {
  const receiptDir = tempRoot();
  const transport = memoryTransport();
  const first = await publishRaw(dailyRaw(), transport, receiptDir);
  const success = fs.readFileSync(path.join(receiptDir, "success.json"));
  await withLock(receiptDir, { timeoutMs: 1000 }, async () => {
    const outcome = await publishReadyFile({
      readyPath: first.staged.readyPath,
      transport,
      receiptDir,
      lockTimeoutMs: 40,
    });
    assert.equal(outcome.exit, 30);
    assert.equal(outcome.body.result, "lock_timeout");
  });
  assert.equal(fs.readFileSync(path.join(receiptDir, "success.json")).equals(success), true);
});

test("concurrent same and different readies serialize", async () => {
  const transport = memoryTransport();
  const root = tempRoot();
  const ready = stageReady(root, dailyRaw());
  const other = dailyObject();
  other.summary = "并发另一份";
  const otherReady = stageReady(tempRoot(), Buffer.from(JSON.stringify(other)));
  const receiptDir = tempRoot();
  const [left, right] = await Promise.all([
    publishReadyFile({ readyPath: ready.readyPath, transport, receiptDir, lockTimeoutMs: 1000 }),
    publishReadyFile({ readyPath: otherReady.readyPath, transport, receiptDir, lockTimeoutMs: 1000 }),
  ]);
  const exits = [left.exit, right.exit].sort();
  assert.deepEqual(exits, [0, 20]);
  const success = JSON.parse(fs.readFileSync(path.join(receiptDir, "success.json"), "utf8"));
  assert.equal(success.status, "success");
  assert.equal(transport.files.size >= 1, true);
});

test("pending failure can be retried into success without dropping the old receipt early", async () => {
  const transport = memoryTransport();
  let remaining = 3;
  const original = transport.publish.bind(transport);
  transport.publish = async (input) => {
    if (remaining > 0) {
      remaining -= 1;
      throw Object.assign(new Error("network"), { code: "network" });
    }
    return original(input);
  };
  const failed = await publishRaw(dailyRaw(), transport);
  assert.equal(failed.outcome.exit, 40);
  remaining = 0;
  const retried = await publishReadyFile({
    readyPath: failed.staged.readyPath,
    transport,
    receiptDir: failed.receiptDir,
    lockTimeoutMs: 1000,
  });
  assert.equal(retried.exit, 0);
  assert.equal(retried.body.result, "published");
});

test("concurrent identical readies publish once", async () => {
  const transport = memoryTransport();
  const staged = stageReady(tempRoot(), dailyRaw());
  const receiptDir = tempRoot();
  const [left, right] = await Promise.all([
    publishReadyFile({ readyPath: staged.readyPath, transport, receiptDir, lockTimeoutMs: 1000 }),
    publishReadyFile({ readyPath: staged.readyPath, transport, receiptDir, lockTimeoutMs: 1000 }),
  ]);
  assert.equal(left.exit, 0);
  assert.equal(right.exit, 0);
  assert.equal(transport.calls.filter((call) => call.op === "publish").length, 1);
});

test("machine results do not carry the briefing body", async () => {
  const published = await publishRaw(dailyRaw(), memoryTransport());
  assert.equal(JSON.stringify(published.outcome.body).includes("合成结论"), false);
  assert.match(published.outcome.body.content_hash, /^[a-f0-9]{64}$/);
});
