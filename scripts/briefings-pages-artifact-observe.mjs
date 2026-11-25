import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backendIdsFromRuntimeToken,
  observeSdkList,
  publicObservation,
  resultsHost,
} from "../lib/pages-artifact-observe.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const override = process.env.PAGES_OBSERVE_ARTIFACT_PACKAGE;
const pkg = override
  ? path.resolve(override)
  : path.join(root, "tools/pages-artifact-observe/node_modules/@actions/artifact");

function report(body) {
  process.stdout.write(`${JSON.stringify(publicObservation(body))}\n`);
}

const uploadedId = process.env.UPLOADED_ARTIFACT_ID || "";
const uploadedDigest = process.env.UPLOADED_ARTIFACT_DIGEST || "";
const base = {
  uploadedId,
  uploadedDigestPresent: uploadedDigest.length > 0,
  uploadedDigest,
  ...backendIdsFromRuntimeToken(process.env.ACTIONS_RUNTIME_TOKEN),
  resultsHost: resultsHost(process.env.ACTIONS_RESULTS_URL),
};

let client;
try {
  const loaded = createRequire(import.meta.url)(pkg);
  client = new loaded.DefaultArtifactClient();
} catch {
  report({ ...base, list: "error", errorCode: "module_load_failed" });
  process.exit(0);
}

try {
  report({ ...base, ...await observeSdkList(client) });
} catch {
  report({ ...base, list: "error", errorCode: "list_failed" });
}
