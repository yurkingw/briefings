import { deploymentBody, deployUploadedArtifact, PagesDeployError } from "../lib/pages-deploy.js";

export async function deployFromActions({
  artifactId,
  buildVersion,
  repository,
  getIdToken,
  request,
  sleep,
  now,
  timeoutMs,
}) {
  const [owner, repo] = String(repository || "").split("/");
  deploymentBody({
    artifactId: artifactId || "",
    buildVersion: buildVersion || "",
    oidcToken: "x",
  });
  let oidcToken;
  try {
    oidcToken = await getIdToken();
  } catch {
    throw new PagesDeployError("oidc_unavailable");
  }
  return deployUploadedArtifact({
    artifactId,
    buildVersion,
    oidcToken,
    owner,
    repo,
    request,
    sleep,
    now,
    timeoutMs,
  });
}

const entry = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : "";
if (import.meta.url === entry) {
  try {
    deploymentBody({
      artifactId: process.env.ARTIFACT_ID || "",
      buildVersion: process.env.GITHUB_SHA || "",
      oidcToken: "x",
    });
    process.stdout.write(`${JSON.stringify({ result: "ready" })}\n`);
  } catch (error) {
    const code = error instanceof PagesDeployError ? error.code : "deploy_failed";
    process.stdout.write(`${JSON.stringify({ result: "error", code })}\n`);
    process.exit(1);
  }
}
