import { decidePublication } from "./decide.js";
import { fail } from "./errors.js";
import { withLock } from "./lock.js";
import { normalizeBriefing } from "./normalize.js";
import { verifyReady } from "./ready.js";
import { writePending, writeSuccess } from "./receipt.js";
import { machineResult } from "./result.js";

function remoteView(bytes) {
  try {
    const normalized = normalizeBriefing(bytes);
    return { contentHash: normalized.contentHash, updatedAtMs: normalized.updatedAtMs };
  } catch {
    return null;
  }
}

function finish(verified, receiptDir, exit, result, attempts, { recordSuccess = false, replaceSuccess = false } = {}) {
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
      exit,
      schema: verified.schema,
      period: verified.period,
      updated_at: verified.updatedAt,
      content_hash: verified.contentHash,
      attempts,
    }),
  };
}

async function runCas({ verified, transport, receiptDir, maxAttempts }) {
  const local = { contentHash: verified.contentHash, updatedAtMs: verified.updatedAtMs };
  const message = `briefing: ${verified.type} ${verified.period}\n\nContent-Hash: ${verified.contentHash}\nUpdated-At: ${verified.updatedAt}\n`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let state;
    try {
      state = await transport.fetchState({ path: verified.remotePath });
    } catch (error) {
      if (error.code === "tree_truncated" || error.code === "ref_missing") {
        return finish(verified, receiptDir, 40, error.code, attempt);
      }
      if (attempt === maxAttempts) return finish(verified, receiptDir, 40, "transport_exhausted", attempt);
      continue;
    }
    if (!state?.commitSha) return finish(verified, receiptDir, 40, "ref_missing", attempt);
    let remote = null;
    if (state.file?.bytes) {
      remote = remoteView(state.file.bytes);
      if (!remote) return finish(verified, receiptDir, 40, "remote_unreadable", attempt);
    }
    const decision = decidePublication(local, remote);
    if (decision.action === "reject") return finish(verified, receiptDir, decision.exit, decision.reason, attempt);
    if (decision.action === "noop") {
      return finish(verified, receiptDir, 0, "noop", attempt, { recordSuccess: decision.reason === "identical" });
    }
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
        return finish(verified, receiptDir, 0, "published", attempt, { recordSuccess: true, replaceSuccess: true });
      }
    } catch (error) {
      if (error.code === "tree_truncated" || error.code === "ref_missing") {
        return finish(verified, receiptDir, 40, error.code, attempt);
      }
      if (error.code === "rejected_non_ff" || error.code === "network" || error.code === "lost_response") {
        if (attempt === maxAttempts) return finish(verified, receiptDir, 40, "transport_exhausted", attempt);
        continue;
      }
      throw error;
    }
  }
  return finish(verified, receiptDir, 40, "transport_exhausted", maxAttempts);
}

export async function publishReadyFile({ readyPath, transport, receiptDir, lockTimeoutMs = 1000, maxAttempts = 3 }) {
  let verified;
  try {
    verified = verifyReady(readyPath);
  } catch (error) {
    return {
      exit: error.exit ?? 11,
      body: machineResult({ result: error.result ?? "ready_mismatch", exit: error.exit ?? 11 }),
    };
  }
  if (!transport?.enabled) {
    return finish(verified, receiptDir, 50, "adapter_disabled", 0);
  }
  try {
    return await withLock(receiptDir, { timeoutMs: lockTimeoutMs }, () =>
      runCas({ verified, transport, receiptDir, maxAttempts }),
    );
  } catch (error) {
    if (error.exit === 30) return finish(verified, receiptDir, 30, "lock_timeout", 0);
    throw error;
  }
}

export { fail };
