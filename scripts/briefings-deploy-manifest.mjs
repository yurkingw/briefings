#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildDeployManifest } from "../lib/publish/inbox.js";

const incoming = JSON.parse(process.env.MANIFEST || "{\"items\":[]}");
const manifest = buildDeployManifest({
  triggerSha: process.env.TRIGGER_SHA || incoming.trigger_sha || "",
  contentSha: process.env.CONTENT_SHA || incoming.content_sha || "",
  items: (incoming.items || []).map((item) => ({
    path: item.path,
    period: item.period,
    schema: item.schema,
    contentHash: item.content_hash,
    payloadSha256: item.payload_sha256,
    blobSha: item.blob_sha,
  })),
});
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`json\n${text}\`\`\`\n`);
}
const site = path.join(process.cwd(), "_site");
if (fs.existsSync(site)) fs.writeFileSync(path.join(site, "publish-manifest.json"), text);
process.stdout.write(text);
