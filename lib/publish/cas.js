import { decidePublication } from "./decide.js";
import { normalizeBriefing } from "./normalize.js";
import { verifyReady } from "./ready.js";
import { writePending, writeSuccess } from "./receipt.js";
import { machineResult } from "./result.js";
import { withLock } from "./lock.js";
import { isInjectedTestTransport } from "./transport/injected.js";

const RETRYABLE = new Set(["network", "lost_response", "rejected_non_ff"]);
const TERMINAL = new Set(["tree_truncated", "ref_missing", "transport_forbidden", "transport_rejected"]);

function remoteView(bytes) {
  try {
    const normalized = normalizeBriefing(bytes);
    return { contentHash: normalized.contentHash, updatedAtMs: normalized.updatedAtMs };
  } catch {
    return null;
  }
}

function finish(verified, receiptDir, exit, result, attempts, reason, { recordSuccess = false, replaceSuccess = false } = {}) {
  const record = {
    result,
    exit,
    schema: verified.schema,
    period: verified.period,
    updated_at: verified.updatedAt,
    content_hash: verified.contentHash,
    raw_sha256: verified.rawSha256,
    snapshot_sha256: verified.snapshotSha256,
    attempts,
  };
  if (exit === 0 && recordSuccess) writeSuccess(receiptDir, record, { replace: replaceSuccess });
  if (exit !== 0 && exit !== 30 && exit !== 50) writePending(receiptDir, record);
  return {
    exit,
    body: machineResult({
      result,
      reason,
      exit,
      schema: verified.schema,
      period: verified.period,
      updated_at: verified.updatedAt,
      content_hash: verified.contentHash,
      attempts,
    }),
  };
}

function transportFailure(error, attempt, maxAttempts) {
  if (TERMINAL.has(error.code)) return { action: "stop", result: error.code, attempt };
  if (RETRYABLE.has(error.code)) {
    if (attempt >= maxAttempts) return { action: "stop", result: "transport_exhausted", attempt };
    return { action: "retry" };
  }
  return null;
}

async function runCas({ verified, transport, receiptDir, maxAttempts }) {
  const local = { contentHash: verified.contentHash, updatedAtMs: verified.updatedAtMs };
  const message = `briefing: ${verified.type} ${verified.period}\n\nContent-Hash: ${verified.contentHash}\nUpdated-At: ${verified.updatedAt}\n`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let state;
    try {
      state = await transport.fetchState({ path: verified.remotePath });
    } catch (error) {
      const failure = transportFailure(error, attempt, maxAttempts);
      if (!failure) throw error;
      if (failure.action === "stop") return finish(verified, receiptDir, 40, failure.result, attempt, failure.result);
      continue;
    }
    if (!state?.commitSha) return finish(verified, receiptDir, 40, "ref_missing", attempt, "ref_missing");
    let remote = null;
    if (state.file?.bytes) {
      remote = remoteView(state.file.bytes);
      if (!remote) return finish(verified, receiptDir, 40, "remote_unreadable", attempt, "remote_unreadable");
    }
    const decision = decidePublication(local, remote);
    if (decision.action === "reject") return finish(verified, receiptDir, decision.exit, decision.reason, attempt, decision.reason);
    if (decision.action === "noop") {
      return finish(verified, receiptDir, 0, "noop", attempt, decision.reason, {
        recordSuccess: decision.reason === "identical",
      });
    }
    const publishReason = decision.reason;
    try {
      await transport.publish({
        baseCommitSha: state.commitSha,
        baseTreeSha: state.treeSha,
        path: verified.remotePath,
        content: verified.snapshotBytes.toString("utf8"),
        message,
      });
      const confirmed = await transport.fetchState({ path: verified.remotePath });
      const confirmedRemote = confirmed.file?.bytes ? remoteView(confirmed.file.bytes) : null;
      const again = decidePublication(local, confirmedRemote);
      if (again.reason === "identical") {
        return finish(verified, receiptDir, 0, "published", attempt, publishReason, {
          recordSuccess: true,
          replaceSuccess: true,
        });
      }
    } catch (error) {
      const failure = transportFailure(error, attempt, maxAttempts);
      if (!failure) throw error;
      if (failure.action === "stop") return finish(verified, receiptDir, 40, failure.result, attempt, failure.result);
      continue;
    }
  }
  return finish(verified, receiptDir, 40, "transport_exhausted", maxAttempts, "transport_exhausted");
}

export async function publishReadyFile({ readyPath, transport, receiptDir, lockTimeoutMs = 1000, maxAttempts = 3 }) {
  let verified;
  try {
    verified = verifyReady(readyPath);
  } catch (error) {
    return {
      exit: error.exit ?? 11,
      body: machineResult({ result: error.result ?? "ready_mismatch", reason: error.result ?? "ready_mismatch", exit: error.exit ?? 11, attempts: 0 }),
    };
  }
  if (!isInjectedTestTransport(transport)) {
    return finish(verified, receiptDir, 50, "adapter_disabled", 0, "adapter_disabled");
  }
  try {
    return await withLock(receiptDir, { timeoutMs: lockTimeoutMs }, () =>
      runCas({ verified, transport, receiptDir, maxAttempts }),
    );
  } catch (error) {
    if (error.exit === 30) return finish(verified, receiptDir, 30, error.result || "lock_timeout", 0, error.result || "lock_timeout");
    throw error;
  }
}

export { isInjectedTestTransport };
