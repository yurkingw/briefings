import { decidePublication } from "./decide.js";
import { isInboxWhitelist } from "./envelope.js";

export function deployAllowed({ shaB, originMain }) {
  return Boolean(shaB) && shaB === originMain;
}

export function ackDecision({ consumedBlobSha, consumedContentHash, remote }) {
  if (!remote || remote.missing) return { delete: false, reason: "missing" };
  if (remote.blobSha !== consumedBlobSha || remote.contentHash !== consumedContentHash) {
    return { delete: false, reason: "superseded" };
  }
  return { delete: true, reason: "match" };
}

export function buildDeployManifest({ triggerSha, contentSha, items }) {
  return {
    manifest_schema: "qianji.briefing.deploy-manifest.v0",
    trigger_sha: triggerSha,
    content_sha: contentSha,
    items: (items || []).map((item) => ({
      path: item.path,
      period: item.period,
      schema: item.schema,
      content_hash: item.contentHash,
      payload_sha256: item.payloadSha256,
      blob_sha: item.blobSha,
    })),
  };
}

export function planInbox({ event, triggerSha, originMain, inbox }) {
  if (!Array.isArray(inbox) || inbox.length === 0) {
    if (event === "schedule") {
      return { deploy: false, exit: 0, reason: "empty_queue", writes: [], ack: [], triggerSha, contentSha: originMain };
    }
    return { deploy: true, exit: 0, reason: "rebuild", writes: [], ack: [], triggerSha, contentSha: originMain };
  }
  const writes = [];
  const ack = [];
  for (const item of inbox) {
    if (!isInboxWhitelist(item.path)) {
      return { deploy: false, exit: 10, reason: "invalid", writes: [], ack: [], triggerSha, contentSha: originMain };
    }
    const decision = decidePublication(
      { contentHash: item.contentHash, updatedAtMs: item.updatedAtMs },
      item.remote ? { contentHash: item.remote.contentHash, updatedAtMs: item.remote.updatedAtMs } : null,
    );
    if (decision.action === "reject") {
      return {
        deploy: false,
        exit: decision.exit,
        reason: decision.reason,
        writes: [],
        ack: [],
        triggerSha,
        contentSha: originMain,
      };
    }
    if (decision.action === "publish") {
      writes.push({ path: item.contentPath, bytes: item.payloadBytes });
    }
    ack.push({
      path: item.path,
      blobSha: item.blobSha,
      contentHash: item.contentHash,
      payloadSha256: item.payloadSha256,
      period: item.period,
      schema: item.schema,
    });
  }
  return {
    deploy: true,
    exit: 0,
    reason: writes.length ? "publish" : "unacked",
    writes,
    ack,
    triggerSha,
    contentSha: writes.length ? null : originMain,
  };
}
