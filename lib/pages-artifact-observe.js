const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{1,20}$/;
const HEX64 = /^[a-f0-9]{64}$/i;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;

const ERROR_CODES = new Set([
  "list_unavailable",
  "list_failed",
  "list_forbidden",
  "list_http_status",
  "list_shape_invalid",
]);

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
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && DIGITS.test(value)) return value;
  return null;
}

function scalarSize(value) {
  const id = scalarId(value);
  return id === null ? null : Number(id);
}

export function rowsFromListBody(body, queryJobId) {
  const artifacts = body && Array.isArray(body.artifacts) ? body.artifacts : null;
  if (!artifacts) return null;
  const rows = [];
  let dropped = 0;
  for (const item of artifacts) {
    if (!item || typeof item !== "object") {
      dropped += 1;
      continue;
    }
    const name = typeof item.name === "string" && NAME.test(item.name) ? item.name : null;
    const id = scalarId(item.database_id ?? item.databaseId ?? item.id);
    const size = scalarSize(item.size);
    if (!name || id === null || size === null) {
      dropped += 1;
      continue;
    }
    const job = item.workflow_job_run_backend_id ?? item.workflowJobRunBackendId;
    let jobScopeMatch = null;
    if (typeof job === "string" && UUID.test(job) && queryJobId) jobScopeMatch = job === queryJobId;
    const row = { name, id, size, jobScopeMatch };
    const digest = item.digest?.value ?? item.digest;
    if (typeof digest === "string" && HEX64.test(digest)) row.digest = digest;
    rows.push(row);
  }
  return { rows, dropped };
}

export function publicObservation(input) {
  const list = input.list === "ok" || input.list === "skipped" || input.list === "error" ? input.list : "error";
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
      if (!row || typeof row !== "object") continue;
      if (typeof row.name !== "string" || !NAME.test(row.name)) continue;
      if (typeof row.id !== "string" || !DIGITS.test(row.id)) continue;
      if (!Number.isInteger(row.size) || row.size < 0) continue;
      const clean = { name: row.name, id: row.id, size: row.size, jobScopeMatch: null };
      if (row.jobScopeMatch === true || row.jobScopeMatch === false) clean.jobScopeMatch = row.jobScopeMatch;
      if (typeof row.digest === "string" && HEX64.test(row.digest)) clean.digest = row.digest;
      rows.push(clean);
    }
    out.count = rows.length;
    out.dropped = Number.isInteger(input.dropped) && input.dropped >= 0 ? input.dropped : 0;
    out.rows = rows;
    out.containsUploadedId = typeof input.uploadedId === "string" && rows.some((row) => row.id === input.uploadedId);
    out.containsUploadedDigest = typeof input.uploadedDigest === "string"
      && input.uploadedDigest.length > 0
      && rows.some((row) => row.digest === input.uploadedDigest);
  }
  if (list === "error" && ERROR_CODES.has(input.errorCode)) out.errorCode = input.errorCode;
  if ((out.errorCode === "list_forbidden" || out.errorCode === "list_http_status")
    && Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599) {
    out.httpStatus = input.httpStatus;
  }
  return out;
}

// One POST, the JSON body of listArtifactsInternal in deploy-pages@d6db901
// (@actions/artifact 2.1.3): two backend ids, no name filter. This is not that
// ncc bundle. The bundle retries five times and can log the raw error text.
export async function listArtifactsOnce({ token, resultsUrl, fetchImpl }) {
  const ids = backendIdsFromRuntimeToken(token);
  if (!ids.resultsScopePresent) return { errorCode: "list_unavailable" };
  let origin;
  try {
    origin = new URL(resultsUrl).origin;
  } catch {
    return { errorCode: "list_unavailable" };
  }
  let response;
  try {
    response = await fetchImpl(new URL("/twirp/github.actions.results.api.v1.ArtifactService/ListArtifacts", origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workflow_run_backend_id: ids.workflowRunBackendId,
        workflow_job_run_backend_id: ids.workflowJobRunBackendId,
      }),
    });
  } catch {
    return { errorCode: "list_failed" };
  }
  if (response.status === 401 || response.status === 403) {
    return { errorCode: "list_forbidden", httpStatus: response.status };
  }
  if (response.status !== 200) return { errorCode: "list_http_status", httpStatus: response.status };
  let json;
  try {
    json = await response.json();
  } catch {
    return { errorCode: "list_shape_invalid" };
  }
  const parsed = rowsFromListBody(json, ids.workflowJobRunBackendId);
  if (!parsed) return { errorCode: "list_shape_invalid" };
  return parsed;
}
