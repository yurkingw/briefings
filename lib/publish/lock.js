import fs from "node:fs";
import path from "node:path";
import { fail } from "./errors.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withLock(dir, { timeoutMs }, fn) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "lock");
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started >= timeoutMs) throw fail(30, "lock_timeout");
      await sleep(10);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
