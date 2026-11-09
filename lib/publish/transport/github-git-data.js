import { asTestTransport } from "./injected.js";

const API = "https://api.github.com";
const TARGET = { owner: "yurkingw", repo: "briefings", ref: "heads/main" };

function coded(code) {
  return Object.assign(new Error(code), { code });
}

async function request(fetchImpl, method, pathname, body) {
  let response;
  try {
    response = await fetchImpl(`${API}/repos/${TARGET.owner}/${TARGET.repo}${pathname}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
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

function decodeBlob(body) {
  if (body.encoding === "base64") return Buffer.from(String(body.content).replace(/\s/g, ""), "base64");
  if (body.encoding === "utf-8") return Buffer.from(body.content);
  throw coded("network");
}

async function fetchState(fetchImpl, { path }) {
  const ref = await request(fetchImpl, "GET", `/git/ref/${TARGET.ref}`);
  if (ref.status === 404) return { commitSha: null, treeSha: null, file: null };
  if (ref.status !== 200) throw coded("transport_rejected");
  const commitSha = ref.body.object.sha;
  const commit = await request(fetchImpl, "GET", `/git/commits/${commitSha}`);
  if (commit.status !== 200) throw coded("transport_rejected");
  const treeSha = commit.body.tree.sha;
  const tree = await request(fetchImpl, "GET", `/git/trees/${treeSha}?recursive=1`);
  if (tree.status !== 200) throw coded("transport_rejected");
  if (tree.body.truncated) throw coded("tree_truncated");
  const entry = (tree.body.tree || []).find((item) => item.path === path);
  if (!entry) return { commitSha, treeSha, file: null };
  const blob = await request(fetchImpl, "GET", `/git/blobs/${entry.sha}`);
  if (blob.status !== 200) throw coded("transport_rejected");
  return { commitSha, treeSha, file: { bytes: decodeBlob(blob.body) } };
}

async function publish(fetchImpl, { baseCommitSha, baseTreeSha, path, content, message }) {
  if (!baseCommitSha || !baseTreeSha) throw coded("ref_missing");
  const blob = await request(fetchImpl, "POST", "/git/blobs", { content, encoding: "utf-8" });
  if (blob.status !== 201 && blob.status !== 200) throw coded("transport_rejected");
  const treeBody = {
    base_tree: baseTreeSha,
    tree: [{ path, mode: "100644", type: "blob", sha: blob.body.sha }],
  };
  const tree = await request(fetchImpl, "POST", "/git/trees", treeBody);
  if (tree.status !== 201 && tree.status !== 200) throw coded("transport_rejected");
  const commit = await request(fetchImpl, "POST", "/git/commits", {
    message,
    tree: tree.body.sha,
    parents: [baseCommitSha],
  });
  if (commit.status !== 201 && commit.status !== 200) throw coded("transport_rejected");
  const updated = await request(fetchImpl, "PATCH", `/git/refs/${TARGET.ref}`, {
    sha: commit.body.sha,
    force: false,
  });
  if (updated.status === 422 || updated.status === 409) throw coded("rejected_non_ff");
  if (updated.status !== 200) throw coded("transport_rejected");
  return { commitSha: commit.body.sha };
}

function disabledTransport() {
  return {
    mode: "disabled",
    production: false,
    async fetchState() {
      throw coded("disabled");
    },
    async publish() {
      throw coded("disabled");
    },
  };
}

export function createGithubGitDataTransport() {
  return disabledTransport();
}

export function createInjectedGitDataTransport(fetchImpl) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl");
  return asTestTransport({
    async fetchState(input) {
      return fetchState(fetchImpl, input);
    },
    async publish(input) {
      return publish(fetchImpl, input);
    },
  });
}
