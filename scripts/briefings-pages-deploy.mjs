import { deploymentBody, deployUploadedArtifact, PagesDeployError } from "../lib/pages-deploy.js";

export async function deployFromActions({ artifactId, buildVersion, repository, getIdToken, request }) {
  const [owner, repo] = String(repository || "").split("/");
  deploymentBody({
    artifactId: artifactId || "",
    buildVersion: buildVersion || "",
    oidcToken: "x",
  });
  const oidcToken = await getIdToken();
  return deployUploadedArtifact({
    artifactId,
    buildVersion,
    oidcToken,
    owner,
    repo,
    request,
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
