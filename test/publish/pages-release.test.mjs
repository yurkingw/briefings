import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { toPublicEnvelope } from "../../lib/publish/envelope.js";
import { planInbox } from "../../lib/publish/inbox.js";
import { stageReady, verifyReady } from "../../lib/publish/ready.js";
import { PAGES_ARTIFACT_NAME, artifactsAfterUpload } from "../../lib/pages-artifact.js";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const adapter = path.join(repo, "test/publish/pages-job-adapter.mjs");
const BUILD = "e12b11e21fdea75f9a73bdc042ab81977c8e4bb6";
const FIRST = "14992589679";
const SECOND = "15015326107";
const THIRD = "15015789905";

function packed(overrides) {
  const staged = stageReady(tempRoot(), dailyRaw({ date: "2026-11-25", ...overrides }));
  return toPublicEnvelope(verifyReady(staged.readyPath));
}

function inboxItem(body, remote) {
  return {
    path: body.path,
    blobSha: "316e5e9de6bed2175adef51a4c3687409e217e51",
    contentHash: body.envelope.content_hash,
    payloadSha256: body.envelope.payload_sha256,
    updatedAtMs: body.updatedAtMs,
    payloadBytes: body.payloadBytes,
    contentPath: `content/daily/${body.envelope.period}.json`,
    period: body.envelope.period,
    schema: body.envelope.schema,
    remote,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function uploadAttempt(previous, uploadedId, outputFile) {
  const visible = artifactsAfterUpload(previous, {
    name: PAGES_ARTIFACT_NAME,
    overwrite: true,
    uploaded: { id: Number(uploadedId), digest: `digest-${uploadedId}` },
  });
  const stale = previous.filter((item) => item.name === PAGES_ARTIFACT_NAME);
  fs.writeFileSync(outputFile, `artifact-id=${uploadedId}\n`);
  const emitted = fs.readFileSync(outputFile, "utf8").match(/^artifact-id=(\d+)$/m)[1];
  return { visible, stale, emitted };
}

function ackExpression(yaml) {
  const block = yaml.slice(yaml.indexOf("\n  ack:\n"));
  const match = block.match(/\n    if: ([^\n]+)/);
  if (!match) throw new Error("ack if missing");
  return match[1].trim();
}

function ackRuns(expression, values) {
  return expression.split("&&").every((part) => {
    const match = part.trim().match(/^([\w.]+) == '([^']*)'$/);
    if (!match) throw new Error(`unparsed ack gate: ${part.trim()}`);
    return values[match[1]] === match[2];
  });
}

function runAdapter(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [adapter], {
      cwd: repo,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr, pid: child.pid, child }));
    child.adapterPid = child;
  });
}

function spawnAdapter(env) {
  const child = spawn(process.execPath, [adapter], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

function waitForLog(file) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("artifact_id")) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 2000) {
        clearInterval(timer);
        reject(new Error("deploy log did not appear"));
      }
    }, 15);
  });
}

test("a failed rerun keeps the inbox until a later attempt uploads a new id", async () => {
  const morning = packed({ updated_at: "2026-11-25T08:00:00+08:00", wave: "晨间" });
  const noon = packed({ updated_at: "2026-11-25T12:56:28+08:00", wave: "午间" });
  const published = planInbox({
    event: "push",
    triggerSha: "noon",
    originMain: "after-morning",
    inbox: [inboxItem(noon, {
      contentHash: morning.envelope.content_hash,
      updatedAtMs: morning.updatedAtMs,
      payloadSha256: morning.envelope.payload_sha256,
    })],
  });
  const files = {
    "content/daily/2026-11-24.json": Buffer.from("yesterday-stays"),
    "content/daily/2026-11-25.json": morning.payloadBytes,
  };
  for (const write of published.writes) files[write.path] = write.bytes;
  assert.equal(files["content/daily/2026-11-24.json"].toString(), "yesterday-stays");
  assert.equal(sha256(files["content/daily/2026-11-25.json"]), noon.envelope.payload_sha256);
  const repeat = planInbox({
    event: "push",
    triggerSha: BUILD,
    originMain: BUILD,
    inbox: [inboxItem(noon, {
      contentHash: noon.envelope.content_hash,
      updatedAtMs: noon.updatedAtMs,
      payloadSha256: noon.envelope.payload_sha256,
    })],
  });
  assert.equal(repeat.writes.length, 0);
  assert.equal(repeat.deploy, true);
  const processScript = fs.readFileSync(path.join(repo, "scripts/briefings-inbox-process.mjs"), "utf8");
  assert.match(processScript, /ack=\$\{plan\.ack\.length \? "true" : "false"\}/);
  const processAck = repeat.ack.length ? "true" : "false";

  const sandbox = tempRoot();
  const outputFile = path.join(sandbox, "artifact-output.txt");
  const logFile = path.join(sandbox, "deploy-log.txt");
  const inboxFile = path.join(sandbox, "inbox.json");
  fs.writeFileSync(inboxFile, noon.bytes);
  const inboxHash = sha256(fs.readFileSync(inboxFile));
  const expression = ackExpression(fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8"));

  const first = uploadAttempt(
    [{ name: PAGES_ARTIFACT_NAME, id: Number(FIRST), digest: "old" }],
    SECOND,
    outputFile,
  );
  assert.equal(first.emitted, SECOND);
  assert.notEqual(first.emitted, String(first.stale[0].id));
  assert.equal(first.visible.some((item) => String(item.id) === FIRST), false);

  const failed = await runAdapter({
    PAGES_JOB: "deploy",
    PAGES_DEPLOY_MODE: "reject",
    PAGES_DEPLOY_LOG: logFile,
    ARTIFACT_ID: first.emitted,
    GITHUB_SHA: BUILD,
    GITHUB_REPOSITORY: "yurkingw/briefings",
  });
  assert.equal(failed.code, 1);
  const failedLine = JSON.parse(fs.readFileSync(logFile, "utf8").trim().split("\n")[0]);
  assert.equal(String(failedLine.artifact_id), first.emitted);
  assert.notEqual(String(failedLine.artifact_id), String(first.stale[0].id));
  assert.equal(ackRuns(expression, {
    "needs.deploy.result": "failure",
    "needs.process.outputs.ack": processAck,
  }), false);
  assert.equal(sha256(fs.readFileSync(inboxFile)), inboxHash);

  const second = uploadAttempt(first.visible, THIRD, outputFile);
  assert.equal(second.emitted, THIRD);
  assert.notEqual(second.emitted, first.emitted);
  fs.rmSync(logFile);
  const recovered = await runAdapter({
    PAGES_JOB: "deploy",
    PAGES_DEPLOY_MODE: "ok",
    PAGES_DEPLOY_LOG: logFile,
    ARTIFACT_ID: second.emitted,
    GITHUB_SHA: BUILD,
    GITHUB_REPOSITORY: "yurkingw/briefings",
  });
  assert.equal(recovered.code, 0);
  const recoveredLine = JSON.parse(fs.readFileSync(logFile, "utf8").trim().split("\n")[0]);
  assert.equal(String(recoveredLine.artifact_id), second.emitted);
  assert.equal(sha256(fs.readFileSync(inboxFile)), inboxHash);
  assert.equal(ackRuns(expression, {
    "needs.deploy.result": "success",
    "needs.process.outputs.ack": processAck,
  }), true);
  const acked = await runAdapter({
    PAGES_JOB: "ack",
    INBOX_FILE: inboxFile,
    ACK_PATH: noon.path,
    ACK_BLOB: "316e5e9de6bed2175adef51a4c3687409e217e51",
    ACK_HASH: noon.envelope.content_hash,
    ACK_PERIOD: noon.envelope.period,
  });
  assert.equal(acked.code, 0);
  assert.equal(fs.existsSync(inboxFile), false);
});

test("killing the deploy process leaves the inbox in place", async () => {
  const sandbox = tempRoot();
  const outputFile = path.join(sandbox, "artifact-output.txt");
  const logFile = path.join(sandbox, "deploy-log.txt");
  const inboxFile = path.join(sandbox, "inbox.json");
  fs.writeFileSync(inboxFile, Buffer.from("inbox-bytes"));
  const inboxHash = sha256(fs.readFileSync(inboxFile));
  const uploaded = uploadAttempt(
    [{ name: PAGES_ARTIFACT_NAME, id: Number(FIRST), digest: "old" }],
    SECOND,
    outputFile,
  );
  const expression = ackExpression(fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8"));
  const child = spawnAdapter({
    PAGES_JOB: "deploy",
    PAGES_DEPLOY_MODE: "hold",
    PAGES_DEPLOY_LOG: logFile,
    ARTIFACT_ID: uploaded.emitted,
    GITHUB_SHA: BUILD,
    GITHUB_REPOSITORY: "yurkingw/briefings",
  });
  const closed = new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  await waitForLog(logFile);
  child.kill("SIGKILL");
  const outcome = await closed;
  assert.equal(outcome.signal, "SIGKILL");
  assert.notEqual(outcome.code, 0);
  const line = JSON.parse(fs.readFileSync(logFile, "utf8").trim().split("\n")[0]);
  assert.equal(String(line.artifact_id), uploaded.emitted);
  assert.notEqual(String(line.artifact_id), String(uploaded.stale[0].id));
  assert.equal(ackRuns(expression, {
    "needs.deploy.result": "failure",
    "needs.process.outputs.ack": "true",
  }), false);
  assert.equal(sha256(fs.readFileSync(inboxFile)), inboxHash);
});

test("the workflow deploy job has no list fallback and no invalid observation", () => {
  const yaml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
  const deploy = yaml.slice(yaml.indexOf("\n  deploy:\n"), yaml.indexOf("\n  ack:\n"));
  assert.equal(deploy.includes("actions/deploy-pages@"), false);
  assert.equal(deploy.includes("briefings-pages-artifact-observe"), false);
  assert.equal(deploy.includes("listArtifacts"), false);
  assert.match(deploy, /ARTIFACT_ID: \$\{\{ steps\.pages-artifact\.outputs\.artifact-id \}\}/);
  assert.equal(deploy.includes("actions: write"), false);
  assert.match(yaml, /needs\.deploy\.result == 'success' && needs\.process\.outputs\.ack == 'true'/);
  assert.equal(fs.existsSync(path.join(repo, "scripts/briefings-pages-artifact-observe.sh")), false);
});
