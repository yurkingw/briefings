import { fail } from "./errors.js";

const API = "https://api.github.com/repos/yurkingw/briefings/contents/";

function coded(code) {
  return Object.assign(new Error(code), { code, result: code });
}

async function call(fetchImpl, token, method, filePath, body) {
  let response;
  try {
    response = await fetchImpl(`${API}${filePath}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw coded("network");
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    throw coded("network");
  }
  const status = response.status;
  if (status === 401 || status === 403) throw coded("transport_forbidden");
  if (status === 408 || status === 429 || status >= 500) throw coded("network");
  if (status === 409) throw coded("conflict");
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw coded("network");
    }
  }
  return { status, body: parsed };
}

export function createContentsTransport({ token, fetchImpl }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  return {
    async get(filePath) {
      const response = await call(fetchFn, token, "GET", `${filePath}?ref=main`);
      if (response.status === 404) return { missing: true };
      if (response.status !== 200) throw coded("transport_rejected");
      const encoded = String(response.body.content || "").replace(/\s/g, "");
      return {
        missing: false,
        blobSha: response.body.sha,
        bytes: Buffer.from(encoded, "base64"),
      };
    },
    async put(filePath, { bytes, blobSha, message }) {
      const body = {
        message,
        content: Buffer.from(bytes).toString("base64"),
        branch: "main",
      };
      if (blobSha) body.sha = blobSha;
      const response = await call(fetchFn, token, "PUT", filePath, body);
      if (response.status !== 200 && response.status !== 201) throw coded("transport_rejected");
      return { blobSha: response.body.content && response.body.content.sha };
    },
    async remove(filePath, { blobSha, message }) {
      const response = await call(fetchFn, token, "DELETE", filePath, {
        message,
        sha: blobSha,
        branch: "main",
      });
      if (response.status !== 200) throw coded("transport_rejected");
      return { deleted: true };
    },
  };
}

export async function ackOnce({ item, transport }) {
  let remote;
  try {
    remote = await transport.get(item.path);
  } catch {
    return { deleted: false, reason: "unknown" };
  }
  if (!remote || remote.missing || remote.blobSha !== item.blobSha) {
    return { deleted: false, reason: "superseded" };
  }
  let contentHash = "";
  try {
    contentHash = JSON.parse(Buffer.from(remote.bytes).toString("utf8")).content_hash;
  } catch {
    return { deleted: false, reason: "unknown" };
  }
  if (contentHash !== item.contentHash) return { deleted: false, reason: "superseded" };
  try {
    await transport.remove(item.path, {
      blobSha: item.blobSha,
      message: `inbox: ack ${item.period}\n\nContent-Hash: ${item.contentHash}\n`,
    });
  } catch (error) {
    if (error.code === "conflict") return { deleted: false, reason: "superseded" };
    throw error;
  }
  return { deleted: true, reason: "match" };
}

export { fail };
