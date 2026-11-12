#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createContentsTransport } from "../lib/publish/contents-api.js";
import { toPublicEnvelope } from "../lib/publish/envelope.js";
import { machineResult } from "../lib/publish/result.js";
import { verifyReady } from "../lib/publish/ready.js";
import { classifyPublishToken, readPublishToken, redact } from "../lib/publish/token.js";
import { uploadPublicEnvelope } from "../lib/publish/upload.js";

function parseArgs(argv) {
  let ready = null;
  let receiptDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ready") ready = argv[++index];
    else if (arg === "--receipt-dir") receiptDir = argv[++index];
    else return { error: true };
  }
  if (!ready || !receiptDir) return { error: true };
  return { ready, receiptDir };
}

function emit(stdout, stderr, fields, token) {
  const line = `${redact(JSON.stringify(machineResult(fields)), token)}\n`;
  stdout.write(line);
  stderr.write(line);
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const parsed = parseArgs(argv);
  if (parsed.error) {
    emit(stdout, stderr, { result: "bad_args", reason: "bad_args", exit: 10, attempts: 0 });
    return 10;
  }
  let packed;
  try {
    packed = toPublicEnvelope(verifyReady(parsed.ready));
  } catch (error) {
    emit(stdout, stderr, {
      result: error.result || "ready_mismatch",
      reason: error.result || "ready_mismatch",
      exit: error.exit || 11,
      attempts: 0,
    });
    return error.exit || 11;
  }
  const env = io.env ?? process.env;
  const token = readPublishToken(env);
  if (!token) {
    const gate = classifyPublishToken(env);
    emit(stdout, stderr, {
      result: "adapter_disabled",
      reason: "adapter_disabled",
      exit: 50,
      attempts: 0,
      schema: packed.envelope.schema,
      period: packed.envelope.period,
      content_hash: packed.envelope.content_hash,
      config_phase: "pre_http",
      token_present: gate.present,
      token_category: gate.category,
    });
    return 50;
  }
  const outcome = await uploadPublicEnvelope({
    bytes: packed.bytes,
    transport: createContentsTransport({ token, fetchImpl: io.fetchImpl }),
  });
  emit(stdout, stderr, {
    result: outcome.result,
    reason: outcome.reason,
    exit: outcome.exit,
    attempts: outcome.attempts,
    schema: outcome.schema,
    period: outcome.period,
    content_hash: outcome.contentHash,
  }, token);
  return outcome.exit;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  process.exit(await main(process.argv.slice(2)));
}
