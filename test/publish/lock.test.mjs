import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withLock } from "../../lib/publish/lock.js";
import { tempRoot } from "./fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function hold(dir) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { withLock } from "./lib/publish/lock.js";
    const dir = process.argv[1];
    await withLock(dir, { timeoutMs: 5000 }, () => new Promise((resolve) => {
      process.stdout.write("held\\n");
      const timer = setInterval(() => {
        fs.appendFileSync(dir + "/beat", "x");
      }, 20);
      process.on("SIGTERM", () => {
        clearInterval(timer);
        resolve();
      });
    }));
  `, dir], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  return child;
}

function waitHeld(child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("holder did not start")), 2000);
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      if (buf.includes("held")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`holder exited early ${code}`));
    });
  });
}

test("a killed holder releases the lock for the next process", async () => {
  const dir = tempRoot();
  fs.mkdirSync(path.join(dir, "lock"));
  const child = hold(dir);
  await waitHeld(child);
  process.kill(child.pid, "SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  const started = Date.now();
  const value = await withLock(dir, { timeoutMs: 1000 }, async () => "acquired");
  assert.equal(value, "acquired");
  assert.ok(Date.now() - started < 800);
});

test("timeout does not steal a lock still held by a live process", async () => {
  const dir = tempRoot();
  const child = hold(dir);
  await waitHeld(child);
  await assert.rejects(
    () => withLock(dir, { timeoutMs: 80 }, async () => "stolen"),
    (error) => error.exit === 30 && error.result === "lock_timeout",
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(child.exitCode, null);
  assert.ok(fs.readFileSync(path.join(dir, "beat"), "utf8").length > 0);
  process.kill(child.pid, "SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
});
