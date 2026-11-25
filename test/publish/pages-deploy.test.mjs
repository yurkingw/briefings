import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectPagesArtifact } from "../../lib/pages-artifact.js";
import { deploymentBody, deployUploadedArtifact, PagesDeployError } from "../../lib/pages-deploy.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD = "847ddf90391fbf61d027f831de780da174bba937";
const STALE_ID = "14992589679";
const UPLOADED_ID = "15015326107";

test("the pages request uses the uploaded id, not the id the job list returned", async () => {
  const listed = selectPagesArtifact([{ name: "github-pages", id: Number(STALE_ID) }]);
  assert.equal(String(listed.id), STALE_ID);
  const calls = [];
  const page = await deployUploadedArtifact({
    artifactId: UPLOADED_ID,
    buildVersion: BUILD,
    oidcToken: "oidc-present",
    owner: "yurkingw",
    repo: "briefings",
    sleep: async () => {},
    request: async (method, route, body) => {
      calls.push({ method, route, body });
      if (method === "POST" && route.endsWith("/pages/deployments")) {
        assert.equal(body.artifact_id, Number(UPLOADED_ID));
        assert.notEqual(body.artifact_id, listed.id);
        assert.equal(body.pages_build_version, BUILD);
        assert.equal(Object.keys(body).join(","), "artifact_id,pages_build_version,oidc_token");
        return { status: 201, body: { id: 4242, status: "deployment_in_progress" } };
      }
      return { status: 200, body: { status: "succeed", page_url: "https://yurkingw.github.io/briefings/" } };
    },
  });
  assert.equal(page, "https://yurkingw.github.io/briefings/");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("a rejected create is not retried", async () => {
  const calls = [];
  await assert.rejects(
    () => deployUploadedArtifact({
      artifactId: STALE_ID,
      buildVersion: BUILD,
      oidcToken: "oidc-present",
      owner: "yurkingw",
      repo: "briefings",
      sleep: async () => { throw new Error("should not poll"); },
      request: async (method, route, body) => {
        calls.push(body.artifact_id);
        return { status: 400, body: { message: "Unable to find artifact mathching the id" } };
      },
    }),
    (error) => error instanceof PagesDeployError && error.code === "create_rejected" && error.status === 400,
  );
  assert.deepEqual(calls, [Number(STALE_ID)]);
});

test("deployment body rejects a missing upload id before any request", () => {
  assert.throws(
    () => deploymentBody({ artifactId: "", buildVersion: BUILD, oidcToken: "oidc-present" }),
    (error) => error.code === "artifact_id_invalid",
  );
});

test("the deploy command reports a fixed code and does not print the token", () => {
  const secret = "ghs_this-token-must-not-appear";
  const result = spawnSync(process.execPath, [path.join(repo, "scripts/briefings-pages-deploy.mjs")], {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ARTIFACT_ID: "",
      GITHUB_SHA: BUILD,
      GITHUB_REPOSITORY: "yurkingw/briefings",
      GITHUB_TOKEN: secret,
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);
  assert.equal(JSON.parse(result.stdout).code, "artifact_id_invalid");
});
