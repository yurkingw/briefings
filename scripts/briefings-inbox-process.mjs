#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isInboxWhitelist, parsePublicEnvelope } from "../lib/publish/envelope.js";
import { buildDeployManifest, planInbox } from "../lib/publish/inbox.js";
import { normalizeBriefing } from "../lib/publish/normalize.js";

export function gitPushArgs() {
  return ["push", "origin", "HEAD:main"];
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function readInbox(repo) {
  const items = [];
  for (const type of ["daily", "weekly"]) {
    const dir = path.join(repo, "_inbox", type);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const rel = `_inbox/${type}/${name}`;
      if (!isInboxWhitelist(rel)) continue;
      const bytes = fs.readFileSync(path.join(repo, rel));
      const parsed = parsePublicEnvelope(bytes);
      if (parsed.path !== rel) continue;
      let remote = null;
      const contentFile = path.join(repo, `content/${type}/${parsed.envelope.period}.json`);
      if (fs.existsSync(contentFile)) {
        const fileBytes = fs.readFileSync(contentFile);
        const normalized = normalizeBriefing(fileBytes);
        remote = {
          contentHash: normalized.contentHash,
          updatedAtMs: normalized.updatedAtMs,
          payloadSha256: createHash("sha256").update(fileBytes).digest("hex"),
        };
      }
      items.push({
        path: rel,
        blobSha: git(repo, ["hash-object", rel]).trim(),
        contentHash: parsed.envelope.content_hash,
        payloadSha256: parsed.envelope.payload_sha256,
        updatedAtMs: parsed.updatedAtMs,
        payloadBytes: parsed.payloadBytes,
        contentPath: `content/${type}/${parsed.envelope.period}.json`,
        period: parsed.envelope.period,
        schema: parsed.envelope.schema,
        type,
        remote,
      });
    }
  }
  return items;
}

export function processRepo(repo, { event, triggerSha } = {}) {
  git(repo, ["fetch", "origin", "main"]);
  git(repo, ["switch", "-C", "main", "origin/main"]);
  const originMain = git(repo, ["rev-parse", "origin/main"]).trim();
  const plan = planInbox({
    event,
    triggerSha,
    originMain,
    inbox: readInbox(repo),
  });
  if (plan.exit !== 0) return { ...plan, contentSha: originMain };
  let contentSha = originMain;
  if (plan.writes.length) {
    git(repo, ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    git(repo, ["config", "user.name", "github-actions[bot]"]);
    for (const file of plan.writes) {
      const full = path.join(repo, file.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, file.bytes);
      git(repo, ["add", "--", file.path]);
    }
    const lines = plan.ack.map((item) => `${item.period} ${item.disposition} ${item.deployedPayloadSha256}`).join("\n");
    git(repo, ["commit", "-m", `inbox: publish\n\n${lines}\n`]);
    git(repo, gitPushArgs());
    contentSha = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["fetch", "origin", "main"]);
    const tip = git(repo, ["rev-parse", "origin/main"]).trim();
    if (tip !== contentSha) {
      return { ...plan, deploy: false, exit: 40, reason: "stale_tip", contentSha, triggerSha };
    }
  }
  return { ...plan, contentSha, triggerSha };
}

function writeOutputs(plan) {
  const manifest = buildDeployManifest({
    triggerSha: plan.triggerSha,
    contentSha: plan.contentSha,
    items: plan.ack,
  });
  const summary = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`json\n${summary}\`\`\`\n`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${plan.deploy ? "true" : "false"}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `content_sha=${plan.contentSha}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `trigger_sha=${plan.triggerSha}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `ack=${plan.ack.length ? "true" : "false"}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `manifest=${JSON.stringify(manifest)}\n`);
  }
  process.stdout.write(summary);
}

function run() {
  const repo = process.cwd();
  const plan = processRepo(repo, {
    event: process.env.GITHUB_EVENT_NAME || "workflow_dispatch",
    triggerSha: process.env.GITHUB_SHA || "",
  });
  writeOutputs(plan);
  process.exit(plan.exit || 0);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) run();
