import {
  backendIdsFromRuntimeToken,
  listArtifactsOnce,
  publicObservation,
  resultsHost,
} from "../lib/pages-artifact-observe.js";

function report(body) {
  process.stdout.write(`${JSON.stringify(publicObservation(body))}\n`);
}

const uploadedId = process.env.UPLOADED_ARTIFACT_ID || "";
const uploadedDigest = process.env.UPLOADED_ARTIFACT_DIGEST || "";
const token = process.env.ACTIONS_RUNTIME_TOKEN;
const ids = backendIdsFromRuntimeToken(token);
const base = {
  uploadedId,
  uploadedDigestPresent: uploadedDigest.length > 0,
  ...ids,
  resultsHost: resultsHost(process.env.ACTIONS_RESULTS_URL),
};

try {
  const listed = await listArtifactsOnce({
    token,
    resultsUrl: process.env.ACTIONS_RESULTS_URL,
    fetchImpl: globalThis.fetch,
  });
  if (listed.errorCode) {
    report({ ...base, list: "error", errorCode: listed.errorCode, httpStatus: listed.httpStatus });
  } else {
    const rows = listed.rows;
    report({
      ...base,
      list: "ok",
      rows,
      dropped: listed.dropped,
      uploadedDigest,
    });
  }
} catch {
  report({ ...base, list: "error", errorCode: "list_failed" });
}
