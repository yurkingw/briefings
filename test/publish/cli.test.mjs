import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../scripts/briefings-publish.mjs";
import { stageReady } from "../../lib/publish/ready.js";
import { asTestTransport } from "../../lib/publish/transport/injected.js";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(args) {
  return spawnSync(process.execPath, [path.join(repo, "scripts/briefings-publish.mjs"), ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

test("the command requires an explicit ready file", () => {
  const result = run([]);
  assert.equal(result.status, 10);
  const body = JSON.parse(result.stdout);
  assert.equal(body.exit, 10);
  assert.equal(result.stdout.includes("合成结论"), false);
});

test("a bare briefing and unknown transport flags are refused", () => {
  const jsonPath = path.join(tempRoot(), "2026-11-10.json");
  fs.writeFileSync(jsonPath, dailyRaw());
  const bare = run(["--ready", jsonPath, "--receipt-dir", tempRoot()]);
  assert.equal(bare.status, 11);
  assert.equal(JSON.parse(bare.stdout).result, "ready_mismatch");
  const flagged = run(["--ready", jsonPath, "--receipt-dir", tempRoot(), "--transport", "file"]);
  assert.equal(flagged.status, 10);
  assert.equal(JSON.parse(flagged.stdout).result, "bad_args");
});

test("the default command validates ready and does not publish", () => {
  const ready = stageReady(tempRoot(), dailyRaw());
  const receiptDir = tempRoot();
  const result = run(["--ready", ready.readyPath, "--receipt-dir", receiptDir]);
  assert.equal(result.status, 50);
  const body = JSON.parse(result.stdout);
  assert.equal(body.result, "adapter_disabled");
  assert.equal(body.period, "2026-11-10");
  assert.match(body.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(result.stdout.includes("合成结论"), false);
  assert.equal(result.stderr.includes("合成结论"), false);
  assert.equal(result.stderr.includes(ready.readyPath), false);
  assert.equal(fs.existsSync(path.join(receiptDir, "success.json")), false);
});

test("in-process injection can exercise the command without an argv transport", async () => {
  const ready = stageReady(tempRoot(), dailyRaw());
  const receiptDir = tempRoot();
  let published = 0;
  let stored = null;
  let commit = "base";
  const chunks = [];
  const exit = await main(["--ready", ready.readyPath, "--receipt-dir", receiptDir], {
    stdout: { write(chunk) { chunks.push(String(chunk)); } },
    stderr: { write() {} },
    transport: asTestTransport({
      enabled: true,
      async fetchState() {
        return { commitSha: commit, treeSha: "tree", file: stored };
      },
      async publish({ content }) {
        published += 1;
        stored = { bytes: Buffer.from(content) };
        commit = "next";
        return { commitSha: commit };
      },
    }),
  });
  assert.equal(exit, 0);
  assert.equal(published, 1);
  assert.equal(JSON.parse(chunks.join("")).result, "published");
});
