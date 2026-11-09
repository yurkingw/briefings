// CA-only offline simulator. This file is not a production carrier and is not
// imported by lib/ or scripts/. It never clones, checks out, or force-updates.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "briefings-offline-test",
  GIT_AUTHOR_EMAIL: "offline-test@example.invalid",
  GIT_COMMITTER_NAME: "briefings-offline-test",
  GIT_COMMITTER_EMAIL: "offline-test@example.invalid",
  GIT_AUTHOR_DATE: "2026-11-10T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-11-10T00:00:00Z",
};

function git(repo, args, input) {
  return execFileSync("git", ["-C", repo, ...args], { input, encoding: "utf8", env });
}

function hashObject(repo, content) {
  return git(repo, ["hash-object", "-w", "--stdin"], content).trim();
}

function listing(repo, tree) {
  const text = git(repo, ["ls-tree", "-r", tree]);
  if (!text.trim()) return [];
  return text.trimEnd().split("\n").map((line) => {
    const [meta, filePath] = line.split("\t");
    const [mode, type, sha] = meta.split(" ");
    return { mode, type, sha, path: filePath };
  });
}

function writeTree(repo, entries) {
  const root = new Map();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part);
    }
    node.set(parts.at(-1), entry);
  }
  function mk(node) {
    const lines = [];
    for (const name of [...node.keys()].sort()) {
      const value = node.get(name);
      if (value instanceof Map) lines.push(`040000 tree ${mk(value)}\t${name}`);
      else lines.push(`${value.mode} ${value.type} ${value.sha}\t${name}`);
    }
    return git(repo, ["mktree"], lines.length ? `${lines.join("\n")}\n` : "").trim();
  }
  return mk(root);
}

function commitTree(repo, tree, parent, message) {
  const args = ["commit-tree", tree];
  if (parent) args.push("-p", parent);
  args.push("-m", message);
  return git(repo, args).trim();
}

export function createBareGitSim() {
  const dir = mkdtempSync(path.join(tmpdir(), "briefings-bare-"));
  execFileSync("git", ["init", "--bare", "-q", dir], { env });
  const keep = hashObject(dir, "keep-v1\n");
  const tree = writeTree(dir, [{ path: "content/other/keep.json", mode: "100644", type: "blob", sha: keep }]);
  const seed = commitTree(dir, tree, null, "seed");
  git(dir, ["update-ref", "refs/heads/main", seed]);
  return {
    enabled: true,
    dir,
    async fetchState({ path: filePath }) {
      const commitSha = git(dir, ["rev-parse", "refs/heads/main"]).trim();
      const treeSha = git(dir, ["rev-parse", `${commitSha}^{tree}`]).trim();
      const entries = listing(dir, treeSha);
      const found = entries.find((entry) => entry.path === filePath);
      const bytes = found ? Buffer.from(git(dir, ["cat-file", "-p", found.sha]), "utf8") : null;
      return { commitSha, treeSha, file: bytes ? { bytes } : null };
    },
    async publish({ baseCommitSha, baseTreeSha, path: filePath, content, message }) {
      const current = git(dir, ["rev-parse", "refs/heads/main"]).trim();
      const currentTree = git(dir, ["rev-parse", `${current}^{tree}`]).trim();
      if (current !== baseCommitSha || currentTree !== baseTreeSha) {
        throw Object.assign(new Error("non-ff"), { code: "rejected_non_ff" });
      }
      const entries = listing(dir, currentTree).filter((entry) => entry.path !== filePath);
      entries.push({ path: filePath, mode: "100644", type: "blob", sha: hashObject(dir, content) });
      const tree = writeTree(dir, entries);
      const next = commitTree(dir, tree, current, message);
      try {
        git(dir, ["update-ref", "refs/heads/main", next, current]);
      } catch (error) {
        throw Object.assign(new Error("non-ff"), { code: "rejected_non_ff", cause: error });
      }
      return { commitSha: next };
    },
  };
}
