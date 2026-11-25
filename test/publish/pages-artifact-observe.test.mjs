import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  backendIdsFromRuntimeToken,
  redactDiagnostic,
  resultsHost,
  summarizeArtifactList,
} from "../../lib/pages-artifact-observe.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function jwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${body}.c2ln`;
}

test("runtime token parsing keeps only the two results ids", () => {
  const token = jwt({
    scp: "Actions.ExampleScope Actions.Results:run-id:job-id",
    secret: "do-not-keep",
  });
  const ids = backendIdsFromRuntimeToken(token);
  assert.deepEqual(ids, {
    runtimeTokenPresent: true,
    payloadDecodable: true,
    resultsScopePresent: true,
    workflowRunBackendId: "run-id",
    workflowJobRunBackendId: "job-id",
  });
  assert.equal(JSON.stringify(ids).includes("do-not-keep"), false);
  assert.equal(JSON.stringify(ids).includes(token), false);
  assert.deepEqual(backendIdsFromRuntimeToken(""), { runtimeTokenPresent: false });
});

test("artifact summary distinguishes an empty list from the uploaded id", () => {
  const empty = summarizeArtifactList([], { uploadedId: "14985772868", uploadedDigest: "abc" });
  assert.equal(empty.count, 0);
  assert.equal(empty.containsUploadedId, false);
  assert.equal(empty.containsUploadedDigest, false);
  const other = summarizeArtifactList(
    [{ name: "not-pages", id: 1, size: 4, digest: "zzz", signed_url: "https://example.test/?sig=secret" }],
    { uploadedId: "14985772868", uploadedDigest: "abc" },
  );
  assert.equal(other.count, 1);
  assert.equal(other.containsUploadedId, false);
  assert.deepEqual(Object.keys(other.rows[0]).sort(), ["digest", "id", "name", "size"]);
  const hit = summarizeArtifactList(
    [{ name: "github-pages", id: 14985772868, size: 10, digest: "abc" }],
    { uploadedId: "14985772868", uploadedDigest: "abc" },
  );
  assert.equal(hit.containsUploadedId, true);
  assert.equal(hit.containsUploadedDigest, true);
});

test("diagnostic text drops token-shaped values", () => {
  const token = jwt({ scp: "Actions.Results:run-id:job-id" });
  const cleaned = redactDiagnostic(`Bearer ${token} failed at https://example.test/list?sig=abc123&x=1`);
  assert.equal(cleaned.includes(token), false);
  assert.equal(cleaned.includes("abc123"), false);
  assert.match(cleaned, /Bearer \[redacted\]/);
  assert.match(cleaned, /sig=\[redacted\]/);
});

test("results host drops the URL path and query", () => {
  assert.equal(resultsHost("https://results.example.test/twirp/list?sig=abc"), "results.example.test");
  assert.equal(resultsHost(""), null);
});

test("the observe script prints one line and does not echo its token", () => {
  const token = jwt({ scp: "Actions.Results:run-id:job-id", secret: "do-not-print" });
  const result = spawnSync(process.execPath, [path.join(repo, "scripts/briefings-pages-artifact-observe.mjs")], {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ACTIONS_RUNTIME_TOKEN: token,
      ACTIONS_RESULTS_URL: "https://results.example.test/twirp/list?sig=abc",
      UPLOADED_ARTIFACT_ID: "14985772868",
      UPLOADED_ARTIFACT_DIGEST: "abc",
    },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stdout.includes("do-not-print"), false);
  assert.equal(result.stdout.includes("sig=abc"), false);
  const body = JSON.parse(result.stdout);
  assert.equal(body.list, "skipped");
  assert.equal(body.workflowRunBackendId, "run-id");
  assert.equal(body.workflowJobRunBackendId, "job-id");
  assert.equal(body.resultsHost, "results.example.test");
  assert.equal(body.uploadedId, "14985772868");
});

test("pages workflow observes the list between upload and deploy", () => {
  const yaml = fsRead();
  const deploy = yaml.slice(yaml.indexOf("\n  deploy:\n"), yaml.indexOf("\n  ack:\n"));
  const upload = deploy.indexOf("id: pages-artifact");
  const observe = deploy.indexOf("scripts/briefings-pages-artifact-observe.mjs");
  const pages = deploy.indexOf("actions/deploy-pages@");
  assert.ok(upload >= 0 && observe > upload && pages > observe);
  const step = deploy.slice(observe - 400, pages);
  assert.match(step, /UPLOADED_ARTIFACT_ID: \$\{\{ steps\.pages-artifact\.outputs\.artifact-id \}\}/);
  assert.match(step, /UPLOADED_ARTIFACT_DIGEST: \$\{\{ steps\.pages-artifact\.outputs\.artifact-digest \}\}/);
  assert.equal(step.includes("ACTIONS_RUNTIME_TOKEN"), false);
  assert.equal(step.includes("GITHUB_TOKEN"), false);
  assert.match(deploy, /overwrite: true/);
  assert.match(deploy, /test "\$tip" = "\$\{\{ needs\.process\.outputs\.content_sha \}\}"/);
  assert.equal(deploy.includes("actions: write"), false);
});

function fsRead() {
  return fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
}
