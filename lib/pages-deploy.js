const DIGITS = /^\d{1,20}$/;
const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9_.-]+$/;

// Status strings copied from actions/deploy-pages@d6db901. A permanent status
// ends the deployment. Anything else is still in progress.
const FINAL_STATUS = new Set([
  "deployment_failed",
  "deployment_perms_error",
  "deployment_content_failed",
  "deployment_cancelled",
  "deployment_lost",
]);

// Status strings from the public "Get the status of a GitHub Pages deployment"
// schema, plus deployment_perms_error from actions/deploy-pages@d6db901.
// Anything else is omitted from the diagnostic line.
const PAGES_STATUS = new Set([
  "deployment_in_progress",
  "syncing_files",
  "finished_file_sync",
  "updating_pages",
  "purging_cdn",
  "deployment_cancelled",
  "deployment_failed",
  "deployment_content_failed",
  "deployment_attempt_error",
  "deployment_lost",
  "succeed",
  "deployment_perms_error",
]);

const DIAGNOSTIC_CODE = new Set([
  "artifact_id_invalid",
  "build_version_invalid",
  "oidc_missing",
  "oidc_unavailable",
  "repo_invalid",
  "create_rejected",
  "deployment_id_invalid",
  "deployment_failed",
  "deployment_perms_error",
  "deployment_content_failed",
  "deployment_cancelled",
  "deployment_lost",
  "timeout",
  "status_errors",
  "transport_failed",
  "deploy_failed",
]);

export class PagesDeployError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// The Pages deployment API takes the public artifact id returned by
// upload-artifact's finalize call. It does not take the databaseId from the
// job-scoped ListArtifacts call that deploy-pages@d6db901 uses.
export function deploymentBody({ artifactId, buildVersion, oidcToken }) {
  if (typeof artifactId !== "string" || !DIGITS.test(artifactId)) throw new PagesDeployError("artifact_id_invalid");
  if (typeof buildVersion !== "string" || !SHA.test(buildVersion)) throw new PagesDeployError("build_version_invalid");
  if (typeof oidcToken !== "string" || oidcToken.length === 0) throw new PagesDeployError("oidc_missing");
  return {
    artifact_id: Number(artifactId),
    pages_build_version: buildVersion,
    oidc_token: oidcToken,
  };
}

function recognizedDeploymentId(value, buildVersion) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== "string") return null;
  const text = value.split("?")[0].split("#")[0];
  if (DIGITS.test(text)) return text;
  if (SHA.test(text) && text === buildVersion) return text;
  return null;
}

// Create responses use an integer id or a string id. The status route also
// accepts the deployment's commit SHA. A SHA is accepted only when it is the
// pages_build_version of this request. A present but unrecognized id is not
// replaced with that SHA.
function deploymentId(body, buildVersion) {
  if (!body || typeof body !== "object") return buildVersion;
  const hasId = body.id !== undefined && body.id !== null && body.id !== "";
  if (hasId) {
    const id = recognizedDeploymentId(body.id, buildVersion);
    if (!id) throw new PagesDeployError("deployment_id_invalid");
    return id;
  }
  if (typeof body.status_url === "string" && body.status_url.length > 0) {
    const id = recognizedDeploymentId(body.status_url.split("/").pop(), buildVersion);
    if (!id) throw new PagesDeployError("deployment_id_invalid");
    return id;
  }
  return buildVersion;
}

function pageUrl(body) {
  return body && typeof body.page_url === "string" && /^https:\/\/[^\s]+$/.test(body.page_url) ? body.page_url : "";
}

// One space-separated line. Fields are copied only after an exact whitelist
// check, so a raw response, header, exception, or token cannot be appended.
export function pagesDiagnosticLine({ phase, http, id, buildVersion, pagesStatus, code } = {}) {
  const parts = [];
  if (phase === "create" || phase === "poll") parts.push(`phase=${phase}`);
  if (typeof http === "number" && Number.isInteger(http) && http >= 100 && http <= 599) parts.push(`http=${http}`);
  if (typeof id === "string" && (DIGITS.test(id) || (typeof buildVersion === "string" && id === buildVersion && SHA.test(id)))) {
    parts.push(`id=${id}`);
  }
  if (typeof pagesStatus === "string" && PAGES_STATUS.has(pagesStatus)) parts.push(`pages_status=${pagesStatus}`);
  if (typeof code === "string" && DIAGNOSTIC_CODE.has(code)) parts.push(`code=${code}`);
  return parts.length ? `pages_deploy ${parts.join(" ")}` : "";
}

function emitDiagnostic(emit, fields) {
  if (typeof emit !== "function") return;
  const line = pagesDiagnosticLine(fields);
  if (!line) return;
  try {
    emit(line);
  } catch {
    // The diagnostic sink must not replace the deployment result.
  }
}

// The Actions boundary used by the workflow. A numeric HTTP error keeps only
// the status integer. Any other failure becomes the fixed transport code.
export async function pagesActionsRequest(request, method, route, body) {
  try {
    const response = await request(`${method} ${route}`, body || {});
    return { status: response.status, body: response.data };
  } catch (error) {
    if (error && typeof error.status === "number") return { status: error.status };
    throw new Error("transport_failed");
  }
}

export async function deployUploadedArtifact({
  artifactId,
  buildVersion,
  oidcToken,
  owner,
  repo,
  request,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 600000,
  intervalMs = 5000,
  maxErrors = 10,
  emit,
}) {
  if (typeof owner !== "string" || !NAME.test(owner) || typeof repo !== "string" || !NAME.test(repo)) {
    emitDiagnostic(emit, { code: "repo_invalid" });
    throw new PagesDeployError("repo_invalid");
  }
  let body;
  try {
    body = deploymentBody({ artifactId, buildVersion, oidcToken });
  } catch (error) {
    emitDiagnostic(emit, { code: error instanceof PagesDeployError ? error.code : undefined });
    throw error;
  }
  const created = await request("POST", `/repos/${owner}/${repo}/pages/deployments`, body);
  let failure = null;
  let id;
  if (!created || created.status < 200 || created.status >= 300) {
    failure = new PagesDeployError("create_rejected", created && created.status);
  } else {
    try {
      id = deploymentId(created.body, buildVersion);
    } catch (error) {
      failure = error;
    }
  }
  emitDiagnostic(emit, {
    phase: "create",
    http: created && created.status,
    id,
    buildVersion,
    pagesStatus: created && created.body && created.body.status,
    code: failure instanceof PagesDeployError ? failure.code : undefined,
  });
  if (failure) throw failure;
  let url = pageUrl(created.body);
  if (created.body && created.body.status === "succeed") return url;
  const started = now();
  let errors = 0;
  while (errors < maxErrors) {
    await sleep(intervalMs);
    if (now() - started >= timeoutMs) {
      emitDiagnostic(emit, { phase: "poll", id, buildVersion, code: "timeout" });
      await request("POST", `/repos/${owner}/${repo}/pages/deployments/${id}/cancel`).catch(() => {});
      throw new PagesDeployError("timeout");
    }
    let status;
    try {
      status = await request("GET", `/repos/${owner}/${repo}/pages/deployments/${id}`);
    } catch {
      errors += 1;
      continue;
    }
    if (!status || status.status < 200 || status.status >= 300) {
      emitDiagnostic(emit, { phase: "poll", http: status && status.status, id, buildVersion });
      errors += 1;
      continue;
    }
    url = pageUrl(status.body) || url;
    const state = status.body && status.body.status;
    emitDiagnostic(emit, {
      phase: "poll",
      http: status.status,
      id,
      buildVersion,
      pagesStatus: state,
      code: FINAL_STATUS.has(state) ? state : undefined,
    });
    if (state === "succeed") return url;
    if (FINAL_STATUS.has(state)) throw new PagesDeployError(state);
  }
  emitDiagnostic(emit, { phase: "poll", id, buildVersion, code: "status_errors" });
  await request("POST", `/repos/${owner}/${repo}/pages/deployments/${id}/cancel`).catch(() => {});
  throw new PagesDeployError("status_errors");
}
