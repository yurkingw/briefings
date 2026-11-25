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
    if (parts[0] === "Actions.Results" && parts.length === 3) {
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
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function summarizeArtifactList(artifacts, { uploadedId = "", uploadedDigest = "" } = {}) {
  const rows = (artifacts || []).map((item) => ({
    name: item && typeof item.name === "string" ? item.name : null,
    id: item && item.id != null ? item.id : null,
    size: item && item.size != null ? item.size : null,
    digest: item && typeof item.digest === "string" ? item.digest : null,
  }));
  return {
    count: rows.length,
    rows,
    containsUploadedId: uploadedId !== "" && rows.some((row) => String(row.id) === String(uploadedId)),
    containsUploadedDigest: uploadedDigest !== "" && rows.some((row) => row.digest === uploadedDigest),
  };
}

export function redactDiagnostic(text) {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([?&](?:sig|token|password)=)[^&\s]+/gi, "$1[redacted]");
}
