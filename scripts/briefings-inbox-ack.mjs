#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ackOnce, createContentsTransport } from "../lib/publish/contents-api.js";
import { isInboxWhitelist } from "../lib/publish/envelope.js";
import { tokenIsUsable } from "../lib/publish/token.js";

export async function ackManifest({ manifest, transport }) {
  const results = [];
  for (const item of manifest.items || []) {
    if (!isInboxWhitelist(item.path)) {
      results.push({ path: item.path, deleted: false, reason: "invalid" });
      continue;
    }
    results.push({
      path: item.path,
      ...(await ackOnce({
        item: {
          path: item.path,
          blobSha: item.blob_sha,
          contentHash: item.content_hash,
          period: item.period,
        },
        transport,
      })),
    });
  }
  const unknown = results.some((item) => item.reason === "unknown");
  return { exit: unknown ? 40 : 0, results };
}

export async function main(argv, io = {}) {
  const raw = io.manifest ?? process.env.MANIFEST;
  let manifest;
  try {
    manifest = JSON.parse(raw || "");
  } catch {
    process.stdout.write(`${JSON.stringify({ result: "invalid", exit: 10 })}\n`);
    return 10;
  }
  const token = io.token ?? process.env.GITHUB_TOKEN;
  if (!io.transport && !tokenIsUsable(token)) {
    process.stdout.write(`${JSON.stringify({ result: "adapter_disabled", exit: 50 })}\n`);
    return 50;
  }
  const transport = io.transport ?? createContentsTransport({ token, fetchImpl: io.fetchImpl });
  const outcome = await ackManifest({ manifest, transport });
  const line = JSON.stringify({ result: outcome.exit === 0 ? "ack" : "unknown", exit: outcome.exit });
  process.stdout.write(`${line}\n`);
  return outcome.exit;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) process.exit(await main(process.argv.slice(2)));
