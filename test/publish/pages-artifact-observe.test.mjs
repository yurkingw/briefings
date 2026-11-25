import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  backendIdsFromRuntimeToken,
  listArtifactsOnce,
  publicObservation,
  resultsHost,
} from "../../lib/pages-artifact-observe.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUN = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

function jwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${body}.c2ln`;
}

const token = jwt({
  scp: `Actions.ExampleScope Actions.Results:${RUN}:${JOB}`,
  secret: "do-not-keep",
});

test("runtime token parsing keeps only two uuid results ids", () => {
  const ids = backendIdsFromRuntimeToken(token);
  assert.equal(ids.workflowRunBackendId, RUN);
  assert.equal(ids.workflowJobRunBackendId, JOB);
  assert.equal(JSON.stringify(ids).includes("do-not-keep"), false);
  assert.equal(JSON.stringify(ids).includes(token), false);
  assert.equal(backendIdsFromRuntimeToken(jwt({ scp: "Actions.Results:not-a-uuid:also-bad" })).resultsScopePresent, false);
});

test("public observation drops raw messages, stacks, and urls", () => {
  const leaked = "https://results.example.test/twirp/ListArtifacts Bearer " + token;
  const out = publicObservation({
    list: "error",
    errorCode: "list_failed",
    errorMessage: leaked,
    stack: leaked,
    url: leaked,
    uploadedId: "14985772868",
    uploadedDigestPresent: true,
  });
  const text = JSON.stringify(out);
  assert.equal(text.includes("http"), false);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes("errorMessage"), false);
  assert.equal(out.errorCode, "list_failed");
  assert.equal(out.uploadedId, "14985772868");
  assert.equal(publicObservation({ list: "error", errorCode: "print the url " + leaked }).errorCode, undefined);
});

test("one list request reports count, id match, forbidden, and shape without the body", async () => {
  const calls = [];
  const secretBody = { artifacts: [], signed_url: "https://blob.example.test/x?sig=secret", msg: token };
  const result = await listArtifactsOnce({
    token,
    resultsUrl: "https://results.example.test/twirp/old?sig=secret",
    fetchImpl: async (url, init) => {
      calls.push({ href: url.href, body: init.body, authorization: init.headers.authorization });
      return { status: 200, async json() { return secretBody; } };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].href, "https://results.example.test/twirp/github.actions.results.api.v1.ArtifactService/ListArtifacts");
  assert.deepEqual(JSON.parse(calls[0].body), {
    workflow_run_backend_id: RUN,
    workflow_job_run_backend_id: JOB,
  });
  assert.equal(result.rows.length, 0);
  assert.equal(JSON.stringify(result).includes("sig=secret"), false);
  assert.equal(JSON.stringify(result).includes(token), false);

  const forbidden = await listArtifactsOnce({
    token,
    resultsUrl: "https://results.example.test",
    fetchImpl: async () => ({ status: 403, async json() { return { message: token }; } }),
  });
  assert.deepEqual(forbidden, { errorCode: "list_forbidden", httpStatus: 403 });

  const matched = await listArtifactsOnce({
    token,
    resultsUrl: "https://results.example.test",
    fetchImpl: async () => ({
      status: 200,
      async json() {
        return {
          artifacts: [{
            name: "github-pages",
            database_id: "14985772868",
            size: "677455",
            workflow_job_run_backend_id: JOB,
            digest: { value: "ab".repeat(32) },
            signed_url: "https://blob.example.test/x?sig=secret",
          }, {
            name: "github-pages",
            database_id: "2",
            size: "3",
            workflow_job_run_backend_id: "33333333-3333-4333-8333-333333333333",
          }],
        };
      },
    }),
  });
  assert.equal(matched.rows.length, 2);
  assert.equal(matched.rows[0].jobScopeMatch, true);
  assert.equal(matched.rows[1].jobScopeMatch, false);
  assert.equal(JSON.stringify(matched).includes("sig=secret"), false);

  const broken = await listArtifactsOnce({
    token,
    resultsUrl: "https://results.example.test",
    fetchImpl: async () => { throw new Error("https://results.example.test/down " + token); },
  });
  assert.deepEqual(broken, { errorCode: "list_failed" });
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

test("the observe command prints one whitelist line and exits 0 when the service fails", async () => {
  const server = http.createServer((request, response) => {
    request.resume();
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "https://results.example.test/secret", token }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const result = await run("sh", [path.join(repo, "scripts/briefings-pages-artifact-observe.sh")], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      ACTIONS_RUNTIME_TOKEN: token,
      ACTIONS_RESULTS_URL: `http://127.0.0.1:${port}/twirp/old?sig=secret`,
      UPLOADED_ARTIFACT_ID: "14985772868",
      UPLOADED_ARTIFACT_DIGEST: "ab".repeat(32),
    },
  });
  await new Promise((resolve) => server.close(resolve));
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stdout.includes("results.example.test"), false);
  assert.equal(result.stdout.includes("sig=secret"), false);
  assert.equal(result.stdout.includes("do-not-keep"), false);
  assert.equal(result.stderr || "", "");
  const body = JSON.parse(result.stdout);
  assert.equal(body.list, "error");
  assert.equal(body.errorCode, "list_http_status");
  assert.equal(body.httpStatus, 500);
  assert.equal(body.uploadedId, "14985772868");
});

test("a missing observe command still exits 0 with a fixed code and no stderr", () => {
  const guarded = spawnSync("sh", [path.join(repo, "scripts/briefings-pages-artifact-observe.sh")], {
    cwd: path.join(repo, "test"),
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(guarded.status, 0);
  assert.equal(guarded.stderr, "");
  assert.equal(JSON.parse(guarded.stdout).errorCode, "list_failed");
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
  assert.equal(step.includes("ACTIONS_RUNTIME_TOKEN"), false);
  assert.equal(deploy.slice(pages).includes("continue-on-error"), false);
  assert.match(deploy, /test "\$tip" = "\$\{\{ needs\.process\.outputs\.content_sha \}\}"/);
  assert.equal(deploy.includes("actions: write"), false);
  assert.equal(resultsHost("https://results.example.test/twirp/list?sig=abc"), "results.example.test");
});
