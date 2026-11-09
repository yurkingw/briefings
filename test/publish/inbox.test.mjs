import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ackOnce } from "../../lib/publish/contents-api.js";
import { toPublicEnvelope } from "../../lib/publish/envelope.js";
import { ackDecision, deployAllowed, planInbox } from "../../lib/publish/inbox.js";
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
});
