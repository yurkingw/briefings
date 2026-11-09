import { decidePublication } from "./decide.js";
import { parsePublicEnvelope } from "./envelope.js";
import { fail } from "./errors.js";

function localView(bytes) {
  const parsed = parsePublicEnvelope(bytes);
  return {
    bytes,
    path: parsed.path,
    contentHash: parsed.envelope.content_hash,
    payloadSha256: parsed.envelope.payload_sha256,
    updatedAt: parsed.envelope.updated_at,
    updatedAtMs: parsed.updatedAtMs,
    schema: parsed.envelope.schema,
    period: parsed.envelope.period,
    message: `inbox: ${parsed.normalized.type} ${parsed.envelope.period}\n\nContent-Hash: ${parsed.envelope.content_hash}\nPayload-Sha256: ${parsed.envelope.payload_sha256}\n`,
  };
}

function remoteView(remote, local) {
  if (!remote || remote.missing) return null;
  let parsed;
  try {
    parsed = parsePublicEnvelope(remote.bytes);
  } catch {
    throw fail(40, "remote_unreadable");
  }
  if (parsed.path !== local.path) throw fail(10, "invalid");
  return {
    blobSha: remote.blobSha,
    contentHash: parsed.envelope.content_hash,
    updatedAtMs: parsed.updatedAtMs,
  };
}

function judge(local, remote) {
  const view = remoteView(remote, local);
  if (!view) return { write: true, result: "absent", exit: 0 };
  const decision = decidePublication(
    { contentHash: local.contentHash, updatedAtMs: local.updatedAtMs },
    { contentHash: view.contentHash, updatedAtMs: view.updatedAtMs },
  );
  if (decision.reason === "identical") return { write: false, result: "uploaded", exit: 0 };
  if (decision.action === "publish") return { write: true, result: decision.reason, exit: 0, blobSha: view.blobSha };
  return { write: false, result: decision.reason, exit: decision.exit };
}

async function confirm(transport, local) {
  try {
    const remote = await transport.get(local.path);
    const gate = judge(local, remote);
    if (gate.result === "uploaded") return { done: true, exit: 0, result: "uploaded" };
    if (!gate.write) return { done: true, exit: gate.exit, result: gate.result };
    return { done: false };
  } catch (error) {
    if (error.code === "transport_forbidden" || error.result === "transport_forbidden") {
      return { done: true, exit: 40, result: "transport_forbidden" };
    }
    return { done: false };
  }
}

function finish(local, exit, result, attempts) {
  return {
    exit,
    result,
    reason: result,
    attempts,
    schema: local.schema,
    period: local.period,
    contentHash: local.contentHash,
  };
}

export async function uploadPublicEnvelope({ bytes, transport, maxAttempts = 3 }) {
  const local = localView(bytes);
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    let remote;
    try {
      remote = await transport.get(local.path);
    } catch (error) {
      if (error.code === "transport_forbidden") return finish(local, 40, "transport_forbidden", attempts);
      if (attempts >= maxAttempts) return finish(local, 40, "unknown", attempts);
      continue;
    }
    let gate;
    try {
      gate = judge(local, remote);
    } catch (error) {
      return finish(local, error.exit || 40, error.result || "unknown", attempts);
    }
    if (!gate.write) return finish(local, gate.exit, gate.result, attempts);
    try {
      await transport.put(local.path, {
        bytes: local.bytes,
        blobSha: remote && remote.blobSha ? remote.blobSha : null,
        message: local.message,
      });
    } catch (error) {
      if (error.code === "transport_forbidden") return finish(local, 40, "transport_forbidden", attempts);
      const checked = await confirm(transport, local);
      if (checked.done) return finish(local, checked.exit, checked.result, attempts);
      if (attempts >= maxAttempts) return finish(local, 40, "unknown", attempts);
      continue;
    }
    const checked = await confirm(transport, local);
    if (checked.done) return finish(local, checked.exit, checked.result, attempts);
    if (attempts >= maxAttempts) return finish(local, 40, "unknown", attempts);
  }
  return finish(local, 40, "unknown", attempts);
}
