const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{1,20}$/;
const HEX64 = /^[a-f0-9]{64}$/i;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;

const ERROR_CODES = new Set([
  "install_failed",
  "module_load_failed",
  "list_failed",
  "list_shape_invalid",
]);

// The runtime token is parsed only for two results UUIDs. This module does
// not send the token and does not choose a request URL.
export function backendIdsFromRuntimeToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    return { runtimeTokenPresent: false };
  }
  const payload = token.split(".")[1];
  if (!payload) return { runtimeTokenPresent: true, payloadDecodable: false };
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { runtimeTokenPresent: true, payloadDecodable: false };
  }
  const scp = typeof decoded.scp === "string" ? decoded.scp : "";
  for (const scope of scp.split(" ")) {
    const parts = scope.split(":");
    if (parts[0] === "Actions.Results" && parts.length === 3 && UUID.test(parts[1]) && UUID.test(parts[2])) {
      return {
        runtimeTokenPresent: true,
        payloadDecodable: true,
        resultsScopePresent: true,
        workflowRunBackendId: parts[1],
        workflowJobRunBackendId: parts[2],
      };
    }
  }
  return { runtimeTokenPresent: true, payloadDecodable: true, resultsScopePresent: false };
}

export function resultsHost(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const host = new URL(url).host;
    return HOST.test(host) ? host : null;
  } catch {
    return null;
  }
}

function scalarId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && DIGITS.test(value)) return value;
  return null;
}

function scalarSize(value) {
  const id = scalarId(value);
  return id === null ? null : Number(id);
}

function rowFromSdkArtifact(item) {
  if (!item || typeof item !== "object") return null;
  const name = typeof item.name === "string" && NAME.test(item.name) ? item.name : null;
  const id = scalarId(item.id);
  const size = scalarSize(item.size);
  if (!name || id === null || size === null) return null;
  const row = { name, id, size, jobScopeMatch: null };
  const digest = item.digest && typeof item.digest === "object" ? item.digest.value : item.digest;
  if (typeof digest === "string" && HEX64.test(digest)) row.digest = digest;
  return row;
}

async function withoutSdkLogs(fn) {
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

// No arguments: the supported call deploy-pages@d6db901 makes. The published
// @actions/artifact 2.1.3 package is not that action's ncc bundle. The
// package's own client may retry an HTTP failure; this function does not
// add another attempt. SDK text written during the call is discarded.
export async function observeSdkList(client) {
  if (!client || typeof client.listArtifacts !== "function") {
    return { list: "error", errorCode: "module_load_failed" };
  }
  let listed;
  try {
    listed = await withoutSdkLogs(() => client.listArtifacts());
  } catch {
    return { list: "error", errorCode: "list_failed" };
  }
  if (!listed || typeof listed !== "object" || !Array.isArray(listed.artifacts)) {
    return { list: "error", errorCode: "list_shape_invalid" };
  }
  const rows = [];
  let dropped = 0;
  for (const item of listed.artifacts) {
    const row = rowFromSdkArtifact(item);
    if (!row) dropped += 1;
    else rows.push(row);
  }
  return { list: "ok", rows, dropped };
}

export function publicObservation(input) {
  const list = input.list === "ok" || input.list === "error" ? input.list : "error";
  const out = { observe: "pages-artifact-list", list };
  if (typeof input.uploadedId === "string" && DIGITS.test(input.uploadedId)) out.uploadedId = input.uploadedId;
  out.uploadedDigestPresent = input.uploadedDigestPresent === true;
  if (input.runtimeTokenPresent === true || input.runtimeTokenPresent === false) {
    out.runtimeTokenPresent = input.runtimeTokenPresent;
  }
  if (input.payloadDecodable === true || input.payloadDecodable === false) out.payloadDecodable = input.payloadDecodable;
  if (input.resultsScopePresent === true || input.resultsScopePresent === false) {
    out.resultsScopePresent = input.resultsScopePresent;
  }
  if (typeof input.workflowRunBackendId === "string" && UUID.test(input.workflowRunBackendId)) {
    out.workflowRunBackendId = input.workflowRunBackendId;
  }
  if (typeof input.workflowJobRunBackendId === "string" && UUID.test(input.workflowJobRunBackendId)) {
    out.workflowJobRunBackendId = input.workflowJobRunBackendId;
  }
  if (typeof input.resultsHost === "string" && HOST.test(input.resultsHost)) out.resultsHost = input.resultsHost;
  if (list === "ok" && Array.isArray(input.rows)) {
    const rows = [];
    for (const row of input.rows) {
      const clean = rowFromSdkArtifact(row);
      if (!clean) continue;
      if (row.jobScopeMatch === true || row.jobScopeMatch === false) clean.jobScopeMatch = row.jobScopeMatch;
      rows.push(clean);
    }
    out.count = rows.length;
    out.dropped = Number.isInteger(input.dropped) && input.dropped >= 0 ? input.dropped : 0;
    out.rows = rows;
    const uploadedDigest = typeof input.uploadedDigest === "string" ? input.uploadedDigest : "";
    out.containsUploadedId = typeof out.uploadedId === "string" && rows.some((row) => row.id === out.uploadedId);
    out.containsUploadedDigest = uploadedDigest.length > 0 && rows.some((row) => row.digest === uploadedDigest);
    if (input.containsUploadedId === true || input.containsUploadedId === false) {
      out.containsUploadedId = input.containsUploadedId;
    }
    if (input.containsUploadedDigest === true || input.containsUploadedDigest === false) {
      out.containsUploadedDigest = input.containsUploadedDigest;
    }
  }
  if (list === "error" && ERROR_CODES.has(input.errorCode)) out.errorCode = input.errorCode;
  return out;
}

export function acceptPublicLine(value) {
  if (!value || typeof value !== "object" || value.observe !== "pages-artifact-list") return null;
  return publicObservation(value);
}
