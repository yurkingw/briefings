import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "./atomic.js";

const SCHEMA = "qianji.briefing.publish-receipt.v1";

function write(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writePending(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  write(path.join(dir, "pending.json"), {
    receipt_schema: SCHEMA,
    status: "pending",
    result: record.result,
    exit: record.exit,
    schema: record.schema,
    period: record.period,
    updated_at: record.updated_at,
    content_hash: record.content_hash,
    attempts: record.attempts,
  });
}

export function writeSuccess(dir, record, { replace }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "success.json");
  if (fs.existsSync(file)) {
    if (!replace) return;
    const previous = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      record.result !== "published" &&
      previous.status === "success" &&
      previous.content_hash === record.content_hash &&
      previous.updated_at === record.updated_at &&
      previous.period === record.period
    ) {
      return;
    }
  }
  write(file, {
    receipt_schema: SCHEMA,
    status: "success",
    result: record.result,
    schema: record.schema,
    period: record.period,
    updated_at: record.updated_at,
    content_hash: record.content_hash,
    raw_sha256: record.raw_sha256,
    snapshot_sha256: record.snapshot_sha256,
    attempts: record.attempts,
  });
}
