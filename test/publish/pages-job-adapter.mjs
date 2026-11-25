import fs from "node:fs";
import { ackOnce } from "../../lib/publish/contents-api.js";
import { deployFromActions } from "../../scripts/briefings-pages-deploy.mjs";
import { PagesDeployError } from "../../lib/pages-deploy.js";

const job = process.env.PAGES_JOB;

if (job === "deploy") {
  const logPath = process.env.PAGES_DEPLOY_LOG;
  const mode = process.env.PAGES_DEPLOY_MODE;
  try {
    await deployFromActions({
      artifactId: process.env.ARTIFACT_ID || "",
      buildVersion: process.env.GITHUB_SHA || "",
      repository: process.env.GITHUB_REPOSITORY || "",
      getIdToken: async () => "oidc-present",
      sleep: async () => {},
      request: async (method, route, body) => {
        fs.appendFileSync(logPath, `${JSON.stringify({
          method,
          route,
          artifact_id: body && body.artifact_id,
        })}\n`);
        if (mode === "hold" && method === "POST" && route.endsWith("/pages/deployments")) {
          await new Promise(() => {
            setInterval(() => {}, 1000);
          });
        }
        if (mode === "reject" && method === "POST" && route.endsWith("/pages/deployments")) {
          return { status: 400, body: { message: "hidden" } };
        }
        if (method === "POST" && route.endsWith("/pages/deployments")) {
          return { status: 200, body: { id: process.env.GITHUB_SHA, status: "deployment_in_progress" } };
        }
        return { status: 200, body: { status: "succeed", page_url: "https://yurkingw.github.io/briefings/" } };
      },
    });
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      result: "error",
      code: error instanceof PagesDeployError ? error.code : "deploy_failed",
    })}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ result: "deployed" })}\n`);
} else if (job === "ack") {
  const inboxFile = process.env.INBOX_FILE;
  const item = {
    path: process.env.ACK_PATH,
    blobSha: process.env.ACK_BLOB,
    contentHash: process.env.ACK_HASH,
    period: process.env.ACK_PERIOD,
  };
  const outcome = await ackOnce({
    item,
    transport: {
      async get(filePath) {
        if (filePath !== item.path || !fs.existsSync(inboxFile)) return { missing: true };
        return { blobSha: item.blobSha, bytes: fs.readFileSync(inboxFile) };
      },
      async remove(filePath) {
        if (filePath !== item.path) throw new Error("ack path mismatch");
        fs.rmSync(inboxFile);
      },
    },
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (!outcome.deleted) process.exit(1);
} else {
  process.stdout.write(`${JSON.stringify({ result: "error", code: "bad_job" })}\n`);
  process.exit(1);
}
