export function decidePublication(local, remote) {
  if (!remote) return { action: "publish", exit: 0, reason: "missing_remote" };
  const sameHash = local.contentHash === remote.contentHash;
  const delta = local.updatedAtMs - remote.updatedAtMs;
  if (sameHash && delta === 0) return { action: "noop", exit: 0, reason: "identical" };
  if (sameHash && delta > 0) return { action: "publish", exit: 0, reason: "stamp_bump" };
  if (sameHash && delta < 0) return { action: "noop", exit: 0, reason: "older_stamp_same_content" };
  if (!sameHash && delta === 0) return { action: "reject", exit: 20, reason: "conflict" };
  if (!sameHash && delta > 0) return { action: "publish", exit: 0, reason: "replace" };
  return { action: "reject", exit: 21, reason: "stale" };
}
