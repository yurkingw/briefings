import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  backendIdsFromRuntimeToken,
  observeSdkList,
  publicObservation,
  resultsHost,
} from "../../lib/pages-artifact-observe.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUN = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const SECRET = "https://results.example.test/twirp/ListArtifacts?sig=secret-token";

function jwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${body}.c2ln`;
}

const token = jwt({
  scp: `Actions.ExampleScope Actions.Results:${RUN}:${JOB}`,
  secret: "do-not-keep",
});

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function fakeNpm(dir, code) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "npm"), `#!/bin/sh
echo '${SECRET}'
echo '${SECRET}' >&2
exit ${code}
`, { mode: 0o755 });
}

function fakeArtifact(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@actions/artifact", main: "index.js" }));
  fs.writeFileSync(path.join(dir, "index.js"), body);
}

test("runtime token parsing keeps only two uuid results ids", () => {
  const ids = backendIdsFromRuntimeToken(token);
  assert.equal(ids.workflowRunBackendId, RUN);
  assert.equal(ids.workflowJobRunBackendId, JOB);
  assert.equal(JSON.stringify(ids).includes("do-not-keep"), false);
  assert.equal(JSON.stringify(ids).includes(token), false);
  assert.equal(backendIdsFromRuntimeToken(jwt({ scp: "Actions.Results:not-a-uuid:also-bad" })).resultsScopePresent, false);
});

test("public observation drops raw messages, stacks, and urls", () => {
  const out = publicObservation({
    list: "error",
    errorCode: "list_failed",
    errorMessage: SECRET,
    stack: SECRET,
    url: SECRET,
    uploadedId: "14985772868",
    uploadedDigestPresent: true,
  });
  const text = JSON.stringify(out);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("errorMessage"), false);
  assert.equal(out.errorCode, "list_failed");
  assert.equal(out.uploadedId, "14985772868");
  assert.equal(publicObservation({ list: "error", errorCode: SECRET }).errorCode, undefined);
});

test("the supported list call takes no arguments and hides sdk text", async () => {
  const calls = [];
  const failed = await observeSdkList({
    listArtifacts(...args) {
      calls.push(args);
      process.stdout.write(`${SECRET}\n`);
      process.stderr.write(`${SECRET}\n`);
      throw new Error(`Failed to ListArtifacts: ${SECRET}`);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 0);
  assert.deepEqual(failed, { list: "error", errorCode: "list_failed" });

  const listed = await observeSdkList({
    listArtifacts() {
      return {
        artifacts: [{
          name: "github-pages",
          id: 14985772868,
          size: 677455,
          signedUrl: SECRET,
          url: SECRET,
        }, { name: "bad name", id: 1, size: 1 }],
      };
    },
  });
  const text = JSON.stringify(listed);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("signedUrl"), false);
  assert.equal(listed.rows.length, 1);
  assert.equal(listed.rows[0].id, "14985772868");
  assert.equal(listed.dropped, 1);
  assert.equal(resultsHost(`https://results.example.test/twirp/list?sig=${SECRET}`), "results.example.test");
});

test("a throwing official client prints one code and not the sdk message", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-artifact-"));
  fakeArtifact(dir, `exports.DefaultArtifactClient = class {
  listArtifacts() {
    process.stdout.write(${JSON.stringify(`${SECRET}\n`)});
    process.stderr.write(${JSON.stringify(`${SECRET}\n`)});
    throw new Error(${JSON.stringify(SECRET)});
  }
};
`);
  const result = await run(process.execPath, [path.join(repo, "scripts/briefings-pages-artifact-observe.mjs")], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      PAGES_OBSERVE_ARTIFACT_PACKAGE: dir,
      ACTIONS_RUNTIME_TOKEN: token,
      ACTIONS_RESULTS_URL: `https://results.example.test/twirp/old?sig=${SECRET}`,
      UPLOADED_ARTIFACT_ID: "14985772868",
      UPLOADED_ARTIFACT_DIGEST: "ab".repeat(32),
    },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stdout.includes("do-not-keep"), false);
  assert.equal(result.stderr.includes(SECRET), false);
  const body = JSON.parse(result.stdout);
  assert.equal(body.list, "error");
  assert.equal(body.errorCode, "list_failed");
  assert.equal(body.uploadedId, "14985772868");
  assert.equal(body.workflowRunBackendId, RUN);
  assert.equal(body.resultsHost, "results.example.test");
});

test("install output is discarded and install failure does not fail the step", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-npm-"));
  fakeNpm(dir, 1);
  const result = await run("sh", [path.join(repo, "scripts/briefings-pages-artifact-observe.sh")], {
    cwd: repo,
    env: { PATH: `${dir}:${process.env.PATH}` },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).errorCode, "install_failed");
});

test("a successful install that prints a secret still cannot leak it or block", async () => {
  const npmDir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-npm-"));
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-artifact-"));
  fakeNpm(npmDir, 0);
  fakeArtifact(artifactDir, `exports.DefaultArtifactClient = class {
  listArtifacts() {
    process.stdout.write(${JSON.stringify(`${SECRET}\n`)});
    throw new Error(${JSON.stringify(SECRET)});
  }
};
`);
  const result = await run("sh", [path.join(repo, "scripts/briefings-pages-artifact-observe.sh")], {
    cwd: repo,
    env: {
      PATH: `${npmDir}:${process.env.PATH}`,
      PAGES_OBSERVE_ARTIFACT_PACKAGE: artifactDir,
      ACTIONS_RUNTIME_TOKEN: token,
    },
  });
  fs.rmSync(npmDir, { recursive: true, force: true });
  fs.rmSync(artifactDir, { recursive: true, force: true });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).errorCode, "list_failed");
});

test("the output filter keeps one schema line and drops raw text", () => {
  const result = spawnSync(process.execPath, [path.join(repo, "scripts/briefings-pages-artifact-observe-filter.mjs")], {
    input: `${SECRET}\n{"observe":"pages-artifact-list","list":"error","errorCode":"list_failed","errorMessage":${JSON.stringify(SECRET)}}\n`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(JSON.parse(result.stdout).errorCode, "list_failed");
});

test("observation sources do not build an authenticated results request", () => {
  const files = [
    "lib/pages-artifact-observe.js",
    "scripts/briefings-pages-artifact-observe.mjs",
    "scripts/briefings-pages-artifact-observe.sh",
    "scripts/briefings-pages-artifact-observe-filter.mjs",
    ".github/workflows/pages.yml",
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(repo, file), "utf8");
    assert.equal(text.includes("twirp"), false, file);
    assert.equal(text.includes("Bearer"), false, file);
    assert.equal(text.toLowerCase().includes("authorization"), false, file);
    assert.equal(text.includes("fetch("), false, file);
  }
});

test("the artifact package is locked to the published 2.1.3 tarball", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, "tools/pages-artifact-observe/package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(repo, "tools/pages-artifact-observe/package-lock.json"), "utf8"));
  assert.equal(manifest.dependencies["@actions/artifact"], "2.1.3");
  const artifact = lock.packages["node_modules/@actions/artifact"];
  assert.equal(artifact.version, "2.1.3");
  assert.equal(artifact.integrity, "sha512-ovuxwbMn0aX8zeQ2ORiZZ0KQYhWwW4NuTCBie530rvxUqaq/83XpqWl1/tHONJuVkck46lfShxjfxhLywTKwyg==");
  assert.equal(lock.packages["node_modules/@actions/http-client"].version, "2.2.0");
  assert.equal(lock.packages["node_modules/@actions/core"].version, "1.10.1");
  assert.equal(lock.packages["node_modules/@actions/github"].version, "5.1.1");
  assert.equal(lock.packages["node_modules/@octokit/request-error"].version, "5.1.1");
});

test("pages workflow does not let observation block deploy", () => {
  const yaml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
  const deploy = yaml.slice(yaml.indexOf("\n  deploy:\n"), yaml.indexOf("\n  ack:\n"));
  const observe = deploy.indexOf("name: Observe the artifact list deploy-pages uses");
  const pages = deploy.indexOf("id: deployment");
  assert.ok(observe >= 0 && pages > observe);
  const step = deploy.slice(observe, pages);
  assert.match(step, /continue-on-error: true/);
  assert.match(step, /briefings-pages-artifact-observe\.sh/);
  assert.equal(step.includes("npm install"), false);
  assert.equal(deploy.slice(pages).includes("continue-on-error"), false);
  assert.match(deploy, /test "\$tip" = "\$\{\{ needs\.process\.outputs\.content_sha \}\}"/);
  assert.equal(deploy.includes("actions: write"), false);
  assert.equal(yaml.includes("PAGES_OBSERVE_ARTIFACT_PACKAGE"), false);
  const shell = fs.readFileSync(path.join(repo, "scripts/briefings-pages-artifact-observe.sh"), "utf8");
  assert.match(shell, /npm ci --omit=dev --ignore-scripts --prefix tools\/pages-artifact-observe/);
  assert.equal(shell.includes("npm install"), false);
});
