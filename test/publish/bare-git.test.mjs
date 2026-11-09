import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { publishReadyFile } from "../../lib/publish/cas.js";
import { stageReady } from "../../lib/publish/ready.js";
import { createBareGitSim } from "./bare-git-sim.mjs";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("bare git simulation publishes one path without moving the other file", async () => {
  const sim = createBareGitSim();
  const outcome = await publishReadyFile({
    readyPath: stageReady(tempRoot(), dailyRaw()).readyPath,
    transport: sim,
    receiptDir: tempRoot(),
    lockTimeoutMs: 1000,
  });
  assert.equal(outcome.exit, 0, JSON.stringify(outcome.body));
  const again = await publishReadyFile({
    readyPath: stageReady(tempRoot(), dailyRaw()).readyPath,
    transport: sim,
    receiptDir: tempRoot(),
    lockTimeoutMs: 1000,
  });
  assert.equal(again.exit, 0);
  assert.equal(again.body.result, "noop");
  const commit = execFileSync("git", ["-C", sim.dir, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
  const keep = execFileSync("git", ["-C", sim.dir, "cat-file", "-p", `${commit}:content/other/keep.json`], { encoding: "utf8" });
  assert.equal(keep, "keep-v1\n");
  const shown = execFileSync("git", ["-C", sim.dir, "cat-file", "-p", `${commit}:content/daily/2026-11-10.json`], { encoding: "utf8" });
  assert.equal(shown.includes("合成结论"), true);
});

test("the offline simulator source is not wired into production files", () => {
  const source = fs.readFileSync(new URL("./bare-git-sim.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("git clone"), false);
  assert.equal(source.includes("git checkout"), false);
  assert.equal(source.includes("--force"), false);
    const cli = fs.readFileSync(path.join(root, "scripts/briefings-publish.mjs"), "utf8");
    assert.equal(cli.includes("createInjectedGitDataTransport"), false);
    assert.equal(cli.includes("process.env"), false);
    for (const relative of ["lib", "scripts"]) {
    const dir = path.join(root, relative);
    for (const file of fs.readdirSync(dir, { recursive: true })) {
      const full = path.join(dir, file.toString());
      if (!fs.statSync(full).isFile()) continue;
      const text = fs.readFileSync(full, "utf8");
      assert.equal(text.includes("bare-git-sim"), false, full);
      assert.equal(text.includes("git clone"), false, full);
      assert.equal(text.includes("git checkout"), false, full);
      assert.equal(text.includes("--force"), false, full);
      assert.equal(text.includes("force-with-lease"), false, full);
      assert.equal(text.includes("GH_TOKEN"), false, full);
      assert.equal(text.includes("GITHUB_TOKEN"), false, full);
    }
  }
});
