import fs from "node:fs";
import path from "node:path";
import { atomicWrite, writeTempOnly } from "./atomic.js";
import { fail } from "./errors.js";
import { normalizeBriefing } from "./normalize.js";

const READY_SCHEMA = "qianji.briefing.export-ready.v1";

function writeObject(root, relative, bytes, { immutable, crash }) {
  const file = path.join(root, relative);
  if (crash) {
    writeTempOnly(file, bytes);
    return;
  }
  if (immutable && fs.existsSync(file)) {
    const current = fs.readFileSync(file);
    if (!current.equals(Buffer.from(bytes))) throw fail(11, "ready_mismatch");
    return;
  }
  atomicWrite(file, bytes);
}

export function stageReady(root, rawBytes, options = {}) {
  const normalized = normalizeBriefing(rawBytes);
  const rawRel = path.posix.join("objects", "raw", `${normalized.rawSha256}.json`);
  const normRel = path.posix.join("objects", "norm", `${normalized.snapshotSha256}.json`);
  const crash = options.crash;
  writeObject(root, rawRel, rawBytes, { immutable: true, crash: crash === "before-raw-rename" });
  if (crash === "before-raw-rename") return { readyPath: null, contentHash: normalized.contentHash };
  writeObject(root, normRel, normalized.snapshot, { immutable: true, crash: crash === "before-norm-rename" });
  if (crash === "before-norm-rename") return { readyPath: null, contentHash: normalized.contentHash };
  const ready = {
    ready_schema: READY_SCHEMA,
    schema: normalized.schema,
    period: normalized.period,
    updated_at: normalized.updatedAt,
    content_hash: normalized.contentHash,
    raw_sha256: normalized.rawSha256,
    snapshot_sha256: normalized.snapshotSha256,
    snapshot: normRel,
    raw: rawRel,
  };
  const readyRel = path.posix.join("ready", `${normalized.type}-${normalized.period}.json`);
  const readyBytes = Buffer.from(`${JSON.stringify(ready, null, 2)}\n`);
  if (crash === "before-ready-rename") {
    writeTempOnly(path.join(root, readyRel), readyBytes);
    return { readyPath: null, contentHash: normalized.contentHash };
  }
  const readyPath = path.join(root, readyRel);
  atomicWrite(readyPath, readyBytes);
  return { readyPath, contentHash: normalized.contentHash };
}

function resolveInside(root, relative) {
  if (typeof relative !== "string" || path.posix.isAbsolute(relative) || path.isAbsolute(relative)) {
    throw fail(11, "ready_mismatch");
  }
  if (relative.split(/[\\/]/).includes("..")) throw fail(11, "ready_mismatch");
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw fail(11, "ready_mismatch");
  return resolved;
}

export function verifyReady(readyPath) {
  let ready;
  try {
    ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  } catch {
    throw fail(11, "ready_mismatch");
  }
  if (!ready || ready.ready_schema !== READY_SCHEMA) throw fail(11, "ready_mismatch");
  const root = path.resolve(path.dirname(readyPath), "..");
  const rawPath = resolveInside(root, ready.raw);
  const snapshotPath = resolveInside(root, ready.snapshot);
  for (const file of [rawPath, snapshotPath, readyPath]) {
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      throw fail(11, "ready_mismatch");
    }
    if (stat.isSymbolicLink()) throw fail(11, "ready_mismatch");
  }
  const raw = fs.readFileSync(rawPath);
  const snapshot = fs.readFileSync(snapshotPath);
  const normalized = normalizeBriefing(raw);
  if (!snapshot.equals(normalized.snapshot)) throw fail(11, "ready_mismatch");
  if (ready.raw_sha256 !== normalized.rawSha256) throw fail(11, "ready_mismatch");
  if (ready.snapshot_sha256 !== normalized.snapshotSha256) throw fail(11, "ready_mismatch");
  if (ready.content_hash !== normalized.contentHash) throw fail(11, "ready_mismatch");
  if (ready.schema !== normalized.schema || ready.period !== normalized.period || ready.updated_at !== normalized.updatedAt) {
    throw fail(11, "ready_mismatch");
  }
  return {
    root,
    ready,
    object: normalized.object,
    snapshotBytes: snapshot,
    contentHash: normalized.contentHash,
    rawSha256: normalized.rawSha256,
    snapshotSha256: normalized.snapshotSha256,
    schema: normalized.schema,
    type: normalized.type,
    period: normalized.period,
    updatedAt: normalized.updatedAt,
    updatedAtMs: normalized.updatedAtMs,
    remotePath: `content/${normalized.type}/${normalized.period}.json`,
  };
}
