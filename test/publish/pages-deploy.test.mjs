import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectPagesArtifact } from "../../lib/pages-artifact.js";
import { deploymentBody, deployUploadedArtifact, PagesDeployError } from "../../lib/pages-deploy.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD = "847ddf90391fbf61d027f831de780da174bba937";
const MORNING_SHA = "76b9e3743cf76304cdc0dbe9b99ef5a4e15b1db2";
const STALE_ID = "14992589679";
const UPLOADED_ID = "15015326107";
const PAGE = "https://yurkingw.github.io/briefings/";

function harness(responseFor) {
  const calls = [];
  return {
    calls,
    request: async (method, route, body) => {
      calls.push({ method, route, body });
      return responseFor(method, route, body);
    },
  };
}

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
    (error) => error instanceof PagesDeployError && error.code === "create_rejected" && error.status === 400 && error.message === "create_rejected",
  );
  assert.deepEqual(calls, [Number(STALE_ID)]);
});

test("a SHA deployment id is polled on that same build version", async () => {
  const seen = harness((method, route) => {
    if (method === "POST") {
      return { status: 200, body: { id: MORNING_SHA, status_url: `https://api.github.com/repos/yurkingw/briefings/pages/deployments/${MORNING_SHA}`, page_url: PAGE } };
    }
    assert.equal(route, `/repos/yurkingw/briefings/pages/deployments/${MORNING_SHA}`);
    return { status: 200, body: { status: "succeed", page_url: PAGE } };
  });
  const page = await deployUploadedArtifact({
    artifactId: UPLOADED_ID,
    buildVersion: MORNING_SHA,
    oidcToken: "oidc-present",
    owner: "yurkingw",
    repo: "briefings",
    sleep: async () => {},
    request: seen.request,
  });
  assert.equal(page, PAGE);
  assert.equal(seen.calls[1].route.endsWith(MORNING_SHA), true);
});

test("a create response without an id is polled by the build version just sent", async () => {
  const seen = harness((method, route) => {
    if (method === "POST") return { status: 200, body: { status: "deployment_in_progress", page_url: PAGE } };
    assert.equal(route, `/repos/yurkingw/briefings/pages/deployments/${MORNING_SHA}`);
    return { status: 200, body: { status: "succeed", page_url: PAGE } };
  });
  await deployUploadedArtifact({
    artifactId: UPLOADED_ID,
    buildVersion: MORNING_SHA,
    oidcToken: "oidc-present",
    owner: "yurkingw",
    repo: "briefings",
    sleep: async () => {},
    request: seen.request,
  });
  assert.equal(seen.calls.filter((call) => call.method === "GET").length, 1);
});

test("a deployment id for a different build is not polled", async () => {
  const seen = harness(() => ({ status: 200, body: { id: "a".repeat(40), status: "succeed", page_url: PAGE } }));
  await assert.rejects(
    () => deployUploadedArtifact({
      artifactId: UPLOADED_ID,
      buildVersion: MORNING_SHA,
      oidcToken: "oidc-present",
      owner: "yurkingw",
      repo: "briefings",
      sleep: async () => { throw new Error("should not poll"); },
      request: seen.request,
    }),
    (error) => error instanceof PagesDeployError && error.code === "deployment_id_invalid" && error.message === "deployment_id_invalid",
  );
  assert.deepEqual(seen.calls.map((call) => call.method), ["POST"]);
});

test("a permanent deployment failure rejects and does not succeed", async () => {
  const seen = harness((method) => method === "POST"
    ? { status: 201, body: { id: 4242, status: "deployment_in_progress" } }
    : { status: 200, body: { status: "deployment_failed" } });
  await assert.rejects(
    () => deployUploadedArtifact({
      artifactId: UPLOADED_ID,
      buildVersion: BUILD,
      oidcToken: "oidc-present",
      owner: "yurkingw",
      repo: "briefings",
      sleep: async () => {},
      request: seen.request,
    }),
    (error) => error instanceof PagesDeployError && error.code === "deployment_failed",
  );
  assert.equal(seen.calls.some((call) => call.route.endsWith("/cancel")), false);
});

test("a timed out deployment rejects before ack could see success", async () => {
  const seen = harness(() => ({ status: 200, body: { id: MORNING_SHA, status: "deployment_in_progress" } }));
  await assert.rejects(
    () => deployUploadedArtifact({
      artifactId: UPLOADED_ID,
      buildVersion: MORNING_SHA,
      oidcToken: "oidc-present",
      owner: "yurkingw",
      repo: "briefings",
      now: () => 0,
      timeoutMs: 0,
      sleep: async () => {},
      request: seen.request,
    }),
    (error) => error instanceof PagesDeployError && error.code === "timeout",
  );
  assert.equal(seen.calls.some((call) => call.method === "GET" && call.route.endsWith("/succeed")), false);
  assert.equal(seen.calls.at(-1).route, `/repos/yurkingw/briefings/pages/deployments/${MORNING_SHA}/cancel`);
});

test("a status url for this build is used when the response omits id", async () => {
  const seen = harness((method, route) => {
    if (method === "POST") {
      return { status: 200, body: { status_url: `https://api.github.com/repos/yurkingw/briefings/pages/deployments/${MORNING_SHA}` } };
    }
    assert.equal(route, `/repos/yurkingw/briefings/pages/deployments/${MORNING_SHA}`);
    return { status: 200, body: { status: "succeed", page_url: PAGE } };
  });
  await deployUploadedArtifact({
    artifactId: UPLOADED_ID,
    buildVersion: MORNING_SHA,
    oidcToken: "oidc-present",
    owner: "yurkingw",
    repo: "briefings",
    sleep: async () => {},
    request: seen.request,
  });
});

test("a status url for a different build is not replaced with this build", async () => {
  const other = "b".repeat(40);
  const seen = harness(() => ({ status: 200, body: { status_url: `https://api.github.com/repos/yurkingw/briefings/pages/deployments/${other}` } }));
  await assert.rejects(
    () => deployUploadedArtifact({
      artifactId: UPLOADED_ID,
      buildVersion: MORNING_SHA,
      oidcToken: "oidc-present",
      owner: "yurkingw",
      repo: "briefings",
      sleep: async () => { throw new Error("should not poll"); },
      request: seen.request,
    }),
    (error) => error.code === "deployment_id_invalid",
  );
  assert.deepEqual(seen.calls.map((call) => call.method), ["POST"]);
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
