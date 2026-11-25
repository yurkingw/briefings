import { createRequire } from "node:module";
import path from "node:path";
import {
  backendIdsFromRuntimeToken,
  redactDiagnostic,
  resultsHost,
  summarizeArtifactList,
} from "../lib/pages-artifact-observe.js";

function report(body) {
  process.stdout.write(`${JSON.stringify(body)}\n`);
}

async function listWithPinnedClient(moduleDir) {
  const require = createRequire(path.join(moduleDir, "@actions/artifact/package.json"));
  const artifact = require("@actions/artifact");
  const client = artifact.default;
  return client.listArtifacts();
}

const uploadedId = process.env.UPLOADED_ARTIFACT_ID || "";
const uploadedDigest = process.env.UPLOADED_ARTIFACT_DIGEST || "";
const moduleDir = process.env.PAGES_OBSERVE_MODULES || "";
const body = {
  observe: "pages-artifact-list",
  uploadedId: uploadedId || null,
  uploadedDigestPresent: uploadedDigest.length > 0,
  ...backendIdsFromRuntimeToken(process.env.ACTIONS_RUNTIME_TOKEN),
  resultsHost: resultsHost(process.env.ACTIONS_RESULTS_URL),
};

try {
  if (!moduleDir) {
    body.list = "skipped";
    body.reason = "no_module_path";
  } else {
    const listed = await listWithPinnedClient(moduleDir);
    const summary = summarizeArtifactList(listed && listed.artifacts, { uploadedId, uploadedDigest });
    body.list = "ok";
    body.count = summary.count;
    body.rows = summary.rows;
    body.containsUploadedId = summary.containsUploadedId;
    body.containsUploadedDigest = summary.containsUploadedDigest;
  }
} catch (error) {
  body.list = "error";
  body.errorName = error && error.name ? error.name : "Error";
  body.errorMessage = redactDiagnostic(error && error.message ? error.message : "");
}

report(body);
