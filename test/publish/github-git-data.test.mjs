import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { publishReadyFile } from "../../lib/publish/cas.js";
import {
  createGithubGitDataTransport,
  createInjectedGitDataTransport,
} from "../../lib/publish/transport/github-git-data.js";
import { isInjectedTestTransport } from "../../lib/publish/transport/injected.js";
import { stageReady } from "../../lib/publish/ready.js";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

function createOrigin() {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  let main = null;
  const requests = [];
  let patches = 0;
  let dropPatchResponse = false;

  function putBlob(content) {
    const sha = sha1(`blob ${Buffer.byteLength(content)}\0${content}`);
    blobs.set(sha, content);
    return sha;
  }
  function putTree(base, updates) {
    const map = new Map();
    if (base) {
      for (const entry of trees.get(base)) map.set(entry.path, { ...entry });
    }
    for (const entry of updates) map.set(entry.path, { ...entry });
    const listing = [...map.values()].sort((left, right) => left.path.localeCompare(right.path));
    const sha = sha1(`tree ${JSON.stringify(listing)}`);
    trees.set(sha, listing);
    return sha;
  }
  function putCommit({ tree, parents, message }) {
    const sha = sha1(`commit ${tree}:${parents.join(",")}:${message}`);
    commits.set(sha, { tree, parents, message });
    return sha;
  }

  const keep = putBlob("keep-v1\n");
  const tree = putTree(null, [{ path: "content/other/keep.json", mode: "100644", type: "blob", sha: keep }]);
  main = putCommit({ tree, parents: [], message: "seed" });

  function json(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
    };
  }

  async function fetchImpl(url, init = {}) {
    const method = init.method ?? "GET";
    const parsed = new URL(url);
    requests.push({ method, pathname: parsed.pathname, search: parsed.search, body: init.body, headers: init.headers });
    if (init.headers?.authorization || init.headers?.Authorization) {
      throw new Error("authorization header is not part of this unit");
    }
    const body = init.body ? JSON.parse(init.body) : null;
    const parts = parsed.pathname.split("/");
    if (method === "GET" && parsed.pathname.endsWith("/git/ref/heads/main")) {
      if (!main) return json(404, { message: "missing" });
      return json(200, { ref: "refs/heads/main", object: { sha: main, type: "commit" } });
    }
    if (method === "GET" && parts.includes("commits")) {
      const sha = parts.at(-1);
      const commit = commits.get(sha);
      return json(200, { sha, tree: { sha: commit.tree }, parents: commit.parents.map((parent) => ({ sha: parent })), message: commit.message });
    }
    if (method === "GET" && parts.includes("trees")) {
      const sha = parts.at(-1);
      return json(200, { sha, truncated: false, tree: trees.get(sha) });
    }
    if (method === "GET" && parts.includes("blobs")) {
      const sha = parts.at(-1);
      return json(200, { sha, encoding: "base64", content: Buffer.from(blobs.get(sha)).toString("base64") });
    }
    if (method === "POST" && parsed.pathname.endsWith("/git/blobs")) {
      if (body.encoding !== "utf-8") return json(422, { message: "encoding" });
      return json(201, { sha: putBlob(body.content) });
    }
    if (method === "POST" && parsed.pathname.endsWith("/git/trees")) {
      if (!Array.isArray(body.tree) || body.tree.length !== 1) return json(422, { message: "tree must replace one path" });
      if (!body.base_tree) return json(422, { message: "base_tree required" });
      return json(201, { sha: putTree(body.base_tree, body.tree) });
    }
    if (method === "POST" && parsed.pathname.endsWith("/git/commits")) {
      return json(201, { sha: putCommit({ tree: body.tree, parents: body.parents, message: body.message }) });
    }
    if (method === "PATCH" && parsed.pathname.endsWith("/git/refs/heads/main")) {
      if (body.force !== false) return json(422, { message: "force must be false" });
      patches += 1;
      if (patches === 1 && !dropPatchResponse) {
        const keepNext = putBlob("keep-v2\n");
        const movedTree = putTree(commits.get(main).tree, [
          { path: "content/other/keep.json", mode: "100644", type: "blob", sha: keepNext },
        ]);
        main = putCommit({ tree: movedTree, parents: [main], message: "move" });
        return json(422, { message: "Update is not a fast forward" });
      }
      const commit = commits.get(body.sha);
      if (!commit || commit.parents[0] !== main) return json(422, { message: "Update is not a fast forward" });
      main = body.sha;
      if (dropPatchResponse) throw new Error("socket hangup");
      return json(200, { ref: "refs/heads/main", object: { sha: main, type: "commit" } });
    }
    return json(404, { message: parsed.pathname });
  }

  return {
    fetchImpl,
    requests,
    blobs,
    trees,
    commits,
    keepText() {
      const listing = trees.get(commits.get(main).tree);
      const keep = listing.find((entry) => entry.path === "content/other/keep.json");
      return blobs.get(keep.sha);
    },
    set dropPatch(value) {
      dropPatchResponse = value;
    },
  };
}

test("disabled github transport never uses global fetch", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => {
    called = true;
    throw new Error("global fetch");
  };
  try {
    const transport = createGithubGitDataTransport();
    assert.equal(isInjectedTestTransport(transport), false);
    const outcome = await publishReadyFile({
      readyPath: stageReady(tempRoot(), dailyRaw()).readyPath,
      transport,
      receiptDir: tempRoot(),
    });
    assert.equal(outcome.exit, 50);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("git data adapter fast-forwards one path from the latest base", async () => {
  const origin = createOrigin();
  const transport = createInjectedGitDataTransport(origin.fetchImpl);
  assert.equal(isInjectedTestTransport(transport), true);
  assert.equal(transport.production, false);
  const staged = stageReady(tempRoot(), dailyRaw());
  const outcome = await publishReadyFile({
    readyPath: staged.readyPath,
    transport,
    receiptDir: tempRoot(),
    lockTimeoutMs: 1000,
  });
  assert.equal(outcome.exit, 0, JSON.stringify(outcome.body));
  assert.equal(outcome.body.result, "published");
  assert.equal(origin.keepText(), "keep-v2\n");
  const trees = origin.requests.filter((request) => request.method === "POST" && request.pathname.endsWith("/git/trees"));
  assert.equal(trees.length, 2);
  const firstTree = JSON.parse(trees[0].body);
  const treeBody = JSON.parse(trees[1].body);
  assert.notEqual(treeBody.base_tree, firstTree.base_tree);
  assert.equal(treeBody.tree.length, 1);
  assert.equal(treeBody.tree[0].path, "content/daily/2026-11-10.json");
  assert.equal(treeBody.tree[0].mode, "100644");
  assert.equal(treeBody.tree[0].type, "blob");
  const patches = origin.requests.filter((request) => request.method === "PATCH");
  assert.equal(patches.length, 2);
  for (const patch of patches) {
    assert.deepEqual(Object.keys(JSON.parse(patch.body)).sort(), ["force", "sha"]);
    assert.equal(JSON.parse(patch.body).force, false);
    assert.equal(patch.pathname, "/repos/yurkingw/briefings/git/refs/heads/main");
    assert.equal(patch.headers.authorization, undefined);
  }
  assert.equal(origin.requests.some((request) => request.pathname === "/repos/yurkingw/briefings/git/ref/heads/main"), true);
  const commit = origin.requests.find((request) => request.method === "POST" && request.pathname.endsWith("/git/commits"));
  const message = JSON.parse(commit.body).message;
  assert.equal(message.includes("Content-Hash: "), true);
  assert.equal(message.includes("Updated-At: 2026-11-10T08:00:00+08:00"), true);
  assert.equal(message.includes(staged.readyPath), false);
});

test("a dropped update response is deduped by rereading the same path", async () => {
  const origin = createOrigin();
  origin.dropPatch = true;
  const transport = createInjectedGitDataTransport(origin.fetchImpl);
  const outcome = await publishReadyFile({
    readyPath: stageReady(tempRoot(), dailyRaw()).readyPath,
    transport,
    receiptDir: tempRoot(),
    lockTimeoutMs: 1000,
  });
  assert.equal(outcome.exit, 0, JSON.stringify(outcome.body));
  const patches = origin.requests.filter((request) => request.method === "PATCH");
  assert.equal(patches.length, 1);
});
