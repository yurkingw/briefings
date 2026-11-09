import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ackOnce } from "../../lib/publish/contents-api.js";
import { toPublicEnvelope } from "../../lib/publish/envelope.js";
import { ackDecision, buildDeployManifest, deployAllowed, planInbox } from "../../lib/publish/inbox.js";
import { stageReady, verifyReady } from "../../lib/publish/ready.js";
import { uploadPublicEnvelope } from "../../lib/publish/upload.js";
import { main as uploadMain } from "../../scripts/briefings-upload.mjs";
import { gitPushArgs, processRepo } from "../../scripts/briefings-inbox-process.mjs";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

const FAKE_TOKEN = "test-only-not-a-credential";

function packed() {
  const staged = stageReady(tempRoot(), dailyRaw());
  return toPublicEnvelope(verifyReady(staged.readyPath));
}

test("public envelope drops the local raw ready", () => {
  const result = packed();
  const text = result.bytes.toString("utf8");
  assert.equal(result.path, "_inbox/daily/2026-11-10.json");
  assert.equal(text.includes("objects/raw"), false);
  assert.equal(text.includes("raw_sha256"), false);
  assert.equal(result.envelope.content_hash, result.envelope.payload.content_hash || result.envelope.content_hash);
  assert.equal(Object.hasOwn(result.envelope, "raw"), false);
});

test("a stale run does not deploy and a current run does", () => {
  assert.equal(deployAllowed({ shaB: "Bold", originMain: "Bnew" }), false);
  assert.equal(deployAllowed({ shaB: "Bnew", originMain: "Bnew" }), true);
});

test("ack does not delete a concurrently replaced envelope", async () => {
  let removed = 0;
  const outcome = await ackOnce({
    item: { path: "_inbox/daily/2026-11-10.json", blobSha: "S1", contentHash: "H1", period: "2026-11-10" },
    transport: {
      async get() {
        return { missing: false, blobSha: "S2", bytes: Buffer.from(`${JSON.stringify({ content_hash: "H2" })}\n`) };
      },
      async remove() {
        removed += 1;
      },
    },
  });
  assert.equal(outcome.deleted, false);
  assert.equal(outcome.reason, "superseded");
  assert.equal(removed, 0);
  assert.equal(ackDecision({
    consumedBlobSha: "S1",
    consumedContentHash: "H1",
    remote: { blobSha: "S1", contentHash: "H1" },
  }).delete, true);
});

test("a lost upload response is confirmed with GET and does not write twice", async () => {
  const body = packed();
  let stored = null;
  let puts = 0;
  const outcome = await uploadPublicEnvelope({
    bytes: body.bytes,
    transport: {
      async get() {
        if (!stored) return { missing: true };
        return { missing: false, blobSha: "blob-1", bytes: stored };
      },
      async put(_filePath, input) {
        puts += 1;
        stored = Buffer.from(input.bytes);
        throw Object.assign(new Error("lost"), { code: "lost_response" });
      },
    },
  });
  assert.equal(outcome.result, "uploaded");
  assert.equal(outcome.exit, 0);
  assert.equal(puts, 1);
});

test("an unreadable upload confirmation is unknown and keeps the local bytes", async () => {
  const body = packed();
  let puts = 0;
  const outcome = await uploadPublicEnvelope({
    bytes: body.bytes,
    transport: {
      async get() {
        throw Object.assign(new Error("down"), { code: "network" });
      },
      async put() {
        puts += 1;
      },
    },
  });
  assert.equal(outcome.result, "unknown");
  assert.equal(outcome.exit, 40);
  assert.equal(puts, 0);
  assert.equal(fs.existsSync(body.path), false);
});

test("permission failures do not retry the upload", async () => {
  let calls = 0;
  const chunks = [];
  const exit = await uploadMain(["--ready", stageReady(tempRoot(), dailyRaw()).readyPath, "--receipt-dir", tempRoot()], {
    env: { BRIEFINGS_PUBLISH_TOKEN: FAKE_TOKEN },
    stdout: { write(chunk) { chunks.push(String(chunk)); } },
    stderr: { write() {} },
    fetchImpl: async () => {
      calls += 1;
      return { status: 403, async text() { return "{\"message\":\"no\"}"; } };
    },
  });
  const stdout = chunks.join("");
  assert.equal(exit, 40);
  assert.equal(calls, 1);
  assert.equal(stdout.includes(FAKE_TOKEN), false);
  assert.equal(stdout.includes("Bearer"), false);
  assert.equal(JSON.parse(stdout).result, "transport_forbidden");
});

test("a missing token does not send HTTP", async () => {
  let calls = 0;
  const chunks = [];
  const exit = await uploadMain(["--ready", stageReady(tempRoot(), dailyRaw()).readyPath, "--receipt-dir", tempRoot()], {
    env: {},
    stdout: { write(chunk) { chunks.push(String(chunk)); } },
    stderr: { write() {} },
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network");
    },
  });
  assert.equal(exit, 50);
  assert.equal(calls, 0);
  assert.equal(JSON.parse(chunks.join("")).result, "adapter_disabled");
});

test("an older timestamp is not recorded as the deployed payload", () => {
  const root = tempRoot();
  const current = toPublicEnvelope(verifyReady(stageReady(root, dailyRaw({ updated_at: "2026-11-09T07:58:04+08:00" })).readyPath));
  const older = toPublicEnvelope(verifyReady(stageReady(tempRoot(), dailyRaw({ updated_at: "2026-11-09T06:00:00+08:00" })).readyPath));
  assert.equal(current.envelope.content_hash, older.envelope.content_hash);
  assert.notEqual(current.envelope.payload_sha256, older.envelope.payload_sha256);
  const item = {
    path: older.path,
    blobSha: "sold",
    contentHash: older.envelope.content_hash,
    payloadSha256: older.envelope.payload_sha256,
    updatedAtMs: older.updatedAtMs,
    payloadBytes: older.payloadBytes,
    contentPath: "content/daily/2026-11-09.json",
    period: "2026-11-09",
    schema: older.envelope.schema,
    remote: {
      contentHash: current.envelope.content_hash,
      updatedAtMs: current.updatedAtMs,
      payloadSha256: current.envelope.payload_sha256,
    },
  };
  const plan = planInbox({ event: "push", triggerSha: "96bdda2", originMain: "d27b56d", inbox: [item] });
  assert.equal(plan.exit, 0);
  assert.equal(plan.writes.length, 0);
  const manifest = buildDeployManifest({ triggerSha: "96bdda2", contentSha: "d27b56d", items: plan.ack });
  const recorded = manifest.items[0];
  assert.equal(recorded.submitted_payload_sha256, older.envelope.payload_sha256);
  assert.equal(recorded.deployed_payload_sha256, current.envelope.payload_sha256);
  assert.notEqual(recorded.submitted_payload_sha256, recorded.deployed_payload_sha256);
  assert.equal(recorded.disposition, "unchanged");
  assert.equal(Object.hasOwn(recorded, "payload_sha256"), false);
  assert.equal(recorded.deployed_payload_sha256, createHash("sha256").update(current.payloadBytes).digest("hex"));
});

test("first publish and identical repeat record the bytes actually written", () => {
  const body = packed();
  const first = planInbox({
    event: "push",
    triggerSha: "A",
    originMain: "M",
    inbox: [{
      path: body.path,
      blobSha: "s1",
      contentHash: body.envelope.content_hash,
      payloadSha256: body.envelope.payload_sha256,
      updatedAtMs: body.updatedAtMs,
      payloadBytes: body.payloadBytes,
      contentPath: "content/daily/2026-11-10.json",
      period: "2026-11-10",
      schema: body.envelope.schema,
      remote: null,
    }],
  });
  assert.equal(first.writes.length, 1);
  const written = createHash("sha256").update(first.writes[0].bytes).digest("hex");
  const firstItem = buildDeployManifest({ triggerSha: "A", contentSha: "B", items: first.ack }).items[0];
  assert.equal(firstItem.disposition, "published");
  assert.equal(firstItem.submitted_payload_sha256, written);
  assert.equal(firstItem.deployed_payload_sha256, written);
  const again = planInbox({
    event: "push",
    triggerSha: "A2",
    originMain: "B",
    inbox: [{
      path: body.path,
      blobSha: "s1",
      contentHash: body.envelope.content_hash,
      payloadSha256: body.envelope.payload_sha256,
      updatedAtMs: body.updatedAtMs,
      payloadBytes: body.payloadBytes,
      contentPath: "content/daily/2026-11-10.json",
      period: "2026-11-10",
      schema: body.envelope.schema,
      remote: {
        contentHash: body.envelope.content_hash,
        updatedAtMs: body.updatedAtMs,
        payloadSha256: written,
      },
    }],
  });
  assert.equal(again.writes.length, 0);
  const repeatItem = buildDeployManifest({ triggerSha: "A2", contentSha: "B", items: again.ack }).items[0];
  assert.equal(repeatItem.disposition, "unchanged");
  assert.equal(repeatItem.deployed_payload_sha256, written);
  assert.equal(repeatItem.submitted_payload_sha256, written);
});

test("schedule does not deploy when nothing was uploaded", () => {
  const plan = planInbox({ event: "schedule", triggerSha: "A", originMain: "M", inbox: [] });
  assert.equal(plan.deploy, false);
  assert.equal(plan.writes.length, 0);
});

test("pages workflow keeps the approved permission split", () => {
  const yaml = fs.readFileSync(path.resolve("test/publish/../../.github/workflows/pages.yml"), "utf8");
  assert.equal(yaml.includes("actions: write"), false);
  assert.equal(yaml.includes("BRIEFINGS_PUBLISH_TOKEN"), false);
  assert.equal(yaml.includes("cancel-in-progress: false"), true);
  assert.match(yaml, /cron: '17 14 \* \* \*'/);
  assert.match(yaml, /cron: '17 1 \* \* 1'/);
  const process = yaml.slice(yaml.indexOf("\n  process:\n"), yaml.indexOf("\n  deploy:\n"));
  const deploy = yaml.slice(yaml.indexOf("\n  deploy:\n"), yaml.indexOf("\n  ack:\n"));
  const ack = yaml.slice(yaml.indexOf("\n  ack:\n"));
  assert.match(process, /contents: write/);
  assert.equal(process.includes("pages:"), false);
  assert.equal(process.includes("id-token:"), false);
  assert.match(deploy, /contents: read/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.equal(deploy.includes("contents: write"), false);
  assert.match(ack, /contents: write/);
  assert.equal(ack.includes("pages:"), false);
  assert.equal(ack.includes("id-token:"), false);
});

test("push arguments are a fast-forward ref update", () => {
  assert.deepEqual(gitPushArgs(), ["push", "origin", "HEAD:main"]);
});

test("process script publishes inbox JSON onto a local main", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "briefings-inbox-"));
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "--bare", "-q", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, ["config", "user.email", "offline-test@example.invalid"]);
  git(repo, ["config", "user.name", "briefings-offline-test"]);
  fs.writeFileSync(path.join(repo, "README.md"), "base\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  git(repo, ["remote", "add", "origin", origin]);
  git(repo, ["push", "origin", "HEAD:main"]);
  const envelope = packed();
  fs.mkdirSync(path.dirname(path.join(repo, envelope.path)), { recursive: true });
  fs.writeFileSync(path.join(repo, envelope.path), envelope.bytes);
  git(repo, ["add", "--", envelope.path]);
  git(repo, ["commit", "-m", "upload inbox"]);
  git(repo, ["push", "origin", "HEAD:main"]);
  const triggerSha = git(repo, ["rev-parse", "HEAD"]).trim();
  const plan = processRepo(repo, { event: "push", triggerSha });
  assert.equal(plan.exit, 0);
  assert.equal(plan.deploy, true);
  const published = git(origin, ["show", `main:content/daily/${envelope.envelope.period}.json`]);
  assert.equal(published.includes("qianji.briefing.daily.v1"), true);
  assert.notEqual(plan.contentSha, plan.triggerSha);
  const contentPath = path.join(repo, `content/daily/${envelope.envelope.period}.json`);
  const contentHash = createHash("sha256").update(fs.readFileSync(contentPath)).digest("hex");
  const firstManifest = buildDeployManifest({ triggerSha: plan.triggerSha, contentSha: plan.contentSha, items: plan.ack });
  assert.equal(firstManifest.items[0].disposition, "published");
  assert.equal(firstManifest.items[0].deployed_payload_sha256, contentHash);
  assert.equal(firstManifest.items[0].submitted_payload_sha256, contentHash);
  assert.notEqual(firstManifest.trigger_sha, firstManifest.content_sha);

  const repeat = processRepo(repo, { event: "push", triggerSha: git(repo, ["rev-parse", "HEAD"]).trim() });
  assert.equal(repeat.exit, 0);
  assert.equal(repeat.writes.length, 0);
  assert.equal(createHash("sha256").update(fs.readFileSync(contentPath)).digest("hex"), contentHash);
  const repeatItem = buildDeployManifest({ triggerSha: repeat.triggerSha, contentSha: repeat.contentSha, items: repeat.ack }).items[0];
  assert.equal(repeatItem.disposition, "unchanged");
  assert.equal(repeatItem.deployed_payload_sha256, contentHash);

  const older = toPublicEnvelope(verifyReady(stageReady(tempRoot(), dailyRaw({ updated_at: "2026-11-10T06:00:00+08:00" })).readyPath));
  assert.equal(older.envelope.content_hash, envelope.envelope.content_hash);
  assert.notEqual(older.envelope.payload_sha256, contentHash);
  fs.writeFileSync(path.join(repo, older.path), older.bytes);
  git(repo, ["add", "--", older.path]);
  git(repo, ["commit", "-m", "older stamp"]);
  git(repo, ["push", "origin", "HEAD:main"]);
  const variable = processRepo(repo, { event: "push", triggerSha: git(repo, ["rev-parse", "HEAD"]).trim() });
  assert.equal(variable.exit, 0);
  assert.equal(variable.writes.length, 0);
  assert.equal(createHash("sha256").update(fs.readFileSync(contentPath)).digest("hex"), contentHash);
  const variableManifest = buildDeployManifest({
    triggerSha: variable.triggerSha,
    contentSha: variable.contentSha,
    items: variable.ack,
  });
  assert.equal(variableManifest.items[0].disposition, "unchanged");
  assert.equal(variableManifest.items[0].submitted_payload_sha256, older.envelope.payload_sha256);
  assert.equal(variableManifest.items[0].deployed_payload_sha256, contentHash);
  fs.mkdirSync(path.join(repo, "_site"));
  execFileSync(process.execPath, [path.resolve("scripts/briefings-deploy-manifest.mjs")], {
    cwd: repo,
    env: {
      ...process.env,
      MANIFEST: JSON.stringify(variableManifest),
      TRIGGER_SHA: variable.triggerSha,
      CONTENT_SHA: variable.contentSha,
    },
    encoding: "utf8",
  });
  const artifact = JSON.parse(fs.readFileSync(path.join(repo, "_site/publish-manifest.json"), "utf8"));
  assert.equal(artifact.items[0].deployed_payload_sha256, contentHash);
  assert.notEqual(artifact.items[0].submitted_payload_sha256, artifact.items[0].deployed_payload_sha256);
  assert.equal(Object.hasOwn(artifact.items[0], "payload_sha256"), false);
  assert.equal(artifact.trigger_sha, variable.triggerSha);
  assert.equal(artifact.content_sha, variable.contentSha);
});
