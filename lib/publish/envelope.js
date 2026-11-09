import { createHash } from "node:crypto";
import { findForbidden } from "../strip-public.js";
import { fail } from "./errors.js";
import { contentHash, normalizeBriefing } from "./normalize.js";

export const ENVELOPE_SCHEMA = "qianji.briefing.inbox.v0";

const WEEK = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
const DAILY = /^\d{4}-\d{2}-\d{2}$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function inboxPath(type, period) {
  if (type === "daily" && DAILY.test(period)) return `_inbox/daily/${period}.json`;
  if (type === "weekly" && WEEK.test(period)) return `_inbox/weekly/${period}.json`;
  throw fail(10, "invalid");
}

export function isInboxWhitelist(filePath) {
  return /^_inbox\/daily\/\d{4}-\d{2}-\d{2}\.json$/.test(filePath)
    || /^_inbox\/weekly\/\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])\.json$/.test(filePath);
}

export function contentPath(type, period) {
  if (type === "daily" && DAILY.test(period)) return `content/daily/${period}.json`;
  if (type === "weekly" && WEEK.test(period)) return `content/weekly/${period}.json`;
  throw fail(10, "invalid");
}

export function toPublicEnvelope(verified) {
  const payloadBytes = Buffer.from(verified.snapshotBytes);
  const payload = JSON.parse(payloadBytes.toString("utf8"));
  const hash = contentHash(payload);
  if (hash !== verified.contentHash) throw fail(11, "ready_mismatch");
  const envelope = {
    envelope_schema: ENVELOPE_SCHEMA,
    schema: verified.schema,
    period: verified.period,
    updated_at: verified.updatedAt,
    content_hash: hash,
    payload_sha256: sha256(payloadBytes),
    payload,
  };
  for (const banned of ["raw", "raw_sha256", "snapshot", "ready"]) {
    if (Object.hasOwn(envelope, banned)) throw fail(10, "invalid");
  }
  const packed = Buffer.from(`${JSON.stringify(envelope)}\n`);
  const text = packed.toString("utf8");
  if (findForbidden(text).length || text.includes("objects/raw") || text.includes("raw_sha256")) {
    throw fail(10, "forbidden");
  }
  return {
    envelope,
    bytes: packed,
    path: inboxPath(verified.type, verified.period),
    payloadBytes,
    updatedAtMs: verified.updatedAtMs,
  };
}

export function parsePublicEnvelope(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  if (findForbidden(text).length || text.includes("objects/raw") || text.includes("raw_sha256")) {
    throw fail(10, "forbidden");
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw fail(10, "bad_json");
  }
  if (!envelope || envelope.envelope_schema !== ENVELOPE_SCHEMA) throw fail(10, "invalid");
  for (const banned of ["raw", "raw_sha256", "snapshot", "ready"]) {
    if (Object.hasOwn(envelope, banned)) throw fail(10, "invalid");
  }
  const normalized = normalizeBriefing(Buffer.from(`${JSON.stringify(envelope.payload)}\n`));
  if (normalized.contentHash !== envelope.content_hash) throw fail(11, "ready_mismatch");
  if (sha256(normalized.snapshotBytes) !== envelope.payload_sha256) throw fail(11, "ready_mismatch");
  if (normalized.schema !== envelope.schema || normalized.period !== envelope.period) throw fail(11, "ready_mismatch");
  if (normalized.updatedAt !== envelope.updated_at) throw fail(11, "ready_mismatch");
  return {
    envelope,
    normalized,
    payloadBytes: normalized.snapshotBytes,
    path: inboxPath(normalized.type, normalized.period),
    updatedAtMs: normalized.updatedAtMs,
  };
}
