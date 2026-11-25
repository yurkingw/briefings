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

function deploymentId(body) {
  if (!body || typeof body !== "object") return null;
  if (typeof body.id === "number" && Number.isSafeInteger(body.id) && body.id >= 0) return String(body.id);
  if (typeof body.id === "string" && DIGITS.test(body.id)) return body.id;
  if (typeof body.status_url === "string") {
    const last = body.status_url.split("/").pop();
    if (DIGITS.test(last)) return last;
  }
  return null;
}

function pageUrl(body) {
  return body && typeof body.page_url === "string" && /^https:\/\/[^\s]+$/.test(body.page_url) ? body.page_url : "";
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
}) {
  if (typeof owner !== "string" || !NAME.test(owner) || typeof repo !== "string" || !NAME.test(repo)) {
    throw new PagesDeployError("repo_invalid");
  }
  const body = deploymentBody({ artifactId, buildVersion, oidcToken });
  const created = await request("POST", `/repos/${owner}/${repo}/pages/deployments`, body);
  if (!created || created.status < 200 || created.status >= 300) {
    throw new PagesDeployError("create_rejected", created && created.status);
  }
  const id = deploymentId(created.body);
  if (!id) throw new PagesDeployError("deployment_id_missing");
  let url = pageUrl(created.body);
  if (created.body && created.body.status === "succeed") return url;
  const started = now();
  let errors = 0;
  while (errors < maxErrors) {
    await sleep(intervalMs);
    if (now() - started >= timeoutMs) {
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
      errors += 1;
      continue;
    }
    url = pageUrl(status.body) || url;
    const state = status.body && status.body.status;
    if (state === "succeed") return url;
    if (FINAL_STATUS.has(state)) throw new PagesDeployError(state);
  }
  await request("POST", `/repos/${owner}/${repo}/pages/deployments/${id}/cancel`).catch(() => {});
  throw new PagesDeployError("status_errors");
}
