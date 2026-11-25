import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deployUploadedArtifact, pagesActionsRequest, pagesDiagnosticLine, PagesDeployError } from "../../lib/pages-deploy.js";
import { deployFromActions } from "../../scripts/briefings-pages-deploy.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD = "57e3472ccaf7f08b246a5fc9eb650582fba0c60c";
const CONTROL = "e12b11e21fdea75f9a73bdc042ab81977c8e4bb6";
const UPLOADED_ID = "15020581433";
const SENTINEL = "SENTINEL-oidc-token-must-not-appear-9f3c";
const PAGE = "https://yurkingw.github.io/briefings/";

function silenceConsole() {
  const names = ["log", "info", "warn", "error", "debug"];
  const original = {};
  const calls = [];
  for (const name of names) {
    original[name] = console[name];
    console[name] = (...args) => {
      calls.push(args.map((item) => String(item)).join(" "));
    };
  }
  return {
    calls,
    restore() {
      for (const name of names) console[name] = original[name];
    },
  };
}

function hiddenBody(status) {
  return {
    status,
    id: `${UPLOADED_ID}\n${SENTINEL}`,
    message: SENTINEL,
    oidc_token: SENTINEL,
    error: { message: SENTINEL },
    headers: { authorization: `Bearer ${SENTINEL}` },
  };
}

test("the diagnostic line keeps only exact whitelist fields", () => {
  assert.equal(pagesDiagnosticLine({
    phase: `create\n${SENTINEL}`,
    http: `400 ${SENTINEL}`,
    id: SENTINEL,
    buildVersion: BUILD,
    pagesStatus: `deployment_failed ${SENTINEL}`,
    code: `create_rejected\n${SENTINEL}`,
  }), "");
  assert.equal(pagesDiagnosticLine({ phase: "create", http: 400.5, code: "create_rejected" }), "pages_deploy phase=create code=create_rejected");
  assert.equal(pagesDiagnosticLine({ phase: "create", http: 99 }), "pages_deploy phase=create");
  assert.equal(
    pagesDiagnosticLine({ phase: "poll", http: 200, id: BUILD, buildVersion: BUILD, pagesStatus: "succeed" }),
    `pages_deploy phase=poll http=200 id=${BUILD} pages_status=succeed`,
  );
  assert.equal(pagesDiagnosticLine({ phase: "poll", id: CONTROL, buildVersion: BUILD }), "pages_deploy phase=poll");
  assert.equal(JSON.stringify(pagesDiagnosticLine({ id: `${BUILD}?${SENTINEL}`, buildVersion: BUILD })).includes(SENTINEL), false);
});

test("a rejected create records http and code without the response", async () => {
  const lines = [];
  const log = silenceConsole();
  try {
    await assert.rejects(
      () => deployUploadedArtifact({
        artifactId: UPLOADED_ID,
        buildVersion: BUILD,
        oidcToken: SENTINEL,
        owner: "yurkingw",
        repo: "briefings",
        emit: (line) => lines.push(line),
        sleep: async () => { throw new Error("should not poll"); },
        request: async () => ({ status: 400, body: hiddenBody(`deployment_failed ${SENTINEL}`), headers: { authorization: SENTINEL } }),
      }),
      (error) => error instanceof PagesDeployError && error.code === "create_rejected" && error.message === "create_rejected" && error.status === 400,
    );
  } finally {
    log.restore();
  }
  assert.deepEqual(lines, ["pages_deploy phase=create http=400 code=create_rejected"]);
  const dumped = JSON.stringify({ lines, console: log.calls });
  assert.equal(dumped.includes(SENTINEL), false);
});

test("a bad deployment id is not copied into the diagnostic line", async () => {
  const lines = [];
  await assert.rejects(
    () => deployUploadedArtifact({
      artifactId: UPLOADED_ID,
      buildVersion: BUILD,
      oidcToken: SENTINEL,
      owner: "yurkingw",
      repo: "briefings",
      emit: (line) => lines.push(line),
      sleep: async () => { throw new Error("should not poll"); },
      request: async () => ({ status: 200, body: { id: SENTINEL, status: `succeed\n${SENTINEL}`, message: SENTINEL } }),
    }),
    (error) => error instanceof PagesDeployError && error.code === "deployment_id_invalid" && error.message === "deployment_id_invalid",
  );
  assert.deepEqual(lines, ["pages_deploy phase=create http=200 code=deployment_id_invalid"]);
  assert.equal(JSON.stringify(lines).includes(SENTINEL), false);
});

test("a permanent poll status records the whitelist line and drops the rest of the body", async () => {
  const lines = [];
  const log = silenceConsole();
  try {
    await assert.rejects(
      () => deployUploadedArtifact({
        artifactId: UPLOADED_ID,
        buildVersion: BUILD,
        oidcToken: SENTINEL,
        owner: "yurkingw",
        repo: "briefings",
        emit: (line) => lines.push(line),
        sleep: async () => {},
        request: async (method) => {
          if (method === "POST") {
            return { status: 201, body: { id: Number(UPLOADED_ID), status: "deployment_in_progress", message: SENTINEL, oidc_token: SENTINEL } };
          }
          return { status: 200, body: { status: "deployment_failed", message: SENTINEL, error: SENTINEL } };
        },
      }),
      (error) => error instanceof PagesDeployError && error.code === "deployment_failed" && error.message === "deployment_failed",
    );
  } finally {
    log.restore();
  }
  assert.deepEqual(lines, [
    `pages_deploy phase=create http=201 id=${UPLOADED_ID} pages_status=deployment_in_progress`,
    `pages_deploy phase=poll http=200 id=${UPLOADED_ID} pages_status=deployment_failed code=deployment_failed`,
  ]);
  assert.equal(JSON.stringify({ lines, console: log.calls }).includes(SENTINEL), false);
});

test("an unrecognized status string is not logged and is not treated as terminal", async () => {
  const lines = [];
  let polls = 0;
  const page = await deployUploadedArtifact({
    artifactId: UPLOADED_ID,
    buildVersion: BUILD,
    oidcToken: SENTINEL,
    owner: "yurkingw",
    repo: "briefings",
    emit: (line) => lines.push(line),
    sleep: async () => {},
    request: async (method) => {
      if (method === "POST") return { status: 200, body: { id: BUILD, message: SENTINEL } };
      polls += 1;
      if (polls === 1) return { status: 200, body: { status: `deployment_failed ${SENTINEL}`, message: SENTINEL } };
      return { status: 200, body: { status: "succeed", page_url: PAGE, message: SENTINEL } };
    },
  });
  assert.equal(page, PAGE);
  assert.deepEqual(lines, [
    `pages_deploy phase=create http=200 id=${BUILD}`,
    `pages_deploy phase=poll http=200 id=${BUILD}`,
    `pages_deploy phase=poll http=200 id=${BUILD} pages_status=succeed`,
  ]);
  assert.equal(JSON.stringify(lines).includes(SENTINEL), false);
});

test("a thrown transport error does not keep its message", async () => {
  await assert.rejects(
    () => pagesActionsRequest(async () => {
      throw Object.assign(new Error(SENTINEL), { response: { data: { message: SENTINEL } } });
    }, "POST", "/repos/yurkingw/briefings/pages/deployments", { oidc_token: SENTINEL }),
    (error) => error instanceof Error && error.message === "transport_failed" && error.code === undefined,
  );
});

test("an http error from the actions client returns only the status integer", async () => {
  const result = await pagesActionsRequest(async () => {
    throw Object.assign(new Error(SENTINEL), {
      status: 422,
      response: { data: { message: SENTINEL, oidc_token: SENTINEL }, headers: { authorization: SENTINEL } },
    });
  }, "POST", "/repos/yurkingw/briefings/pages/deployments", { oidc_token: SENTINEL });
  assert.deepEqual(result, { status: 422 });
  assert.equal(JSON.stringify(result).includes(SENTINEL), false);
});

test("a diagnostic sink failure still rejects the create", async () => {
  await assert.rejects(
    () => deployUploadedArtifact({
      artifactId: UPLOADED_ID,
      buildVersion: BUILD,
      oidcToken: SENTINEL,
      owner: "yurkingw",
      repo: "briefings",
      emit: () => { throw new Error(SENTINEL); },
      sleep: async () => { throw new Error("should not poll"); },
      request: async () => ({ status: 400, body: { message: SENTINEL } }),
    }),
    (error) => error instanceof PagesDeployError && error.code === "create_rejected",
  );
});

test("oidc failure emits only the fixed code", async () => {
  const lines = [];
  await assert.rejects(
    () => deployFromActions({
      artifactId: UPLOADED_ID,
      buildVersion: BUILD,
      repository: "yurkingw/briefings",
      getIdToken: async () => { throw new Error(SENTINEL); },
      emit: (line) => lines.push(line),
      request: async () => { throw new Error(`should not request ${SENTINEL}`); },
    }),
    (error) => error instanceof PagesDeployError && error.code === "oidc_unavailable" && error.message === "oidc_unavailable",
  );
  assert.deepEqual(lines, ["pages_deploy code=oidc_unavailable"]);
  assert.equal(JSON.stringify(lines).includes(SENTINEL), false);
});

test("the saved pages status evidence is the whitelist body only", () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(repo, "docs/evidence/pages-status-2026-11-25.json"), "utf8"));
  assert.equal(evidence.control.sha, CONTROL);
  assert.equal(evidence.control.session_stdout.body.status, "succeed");
  assert.equal(evidence.control.reread_stdout.body.status, "succeed");
  assert.equal(evidence.variable.sha, BUILD);
  assert.equal(evidence.variable.run_id, 45612559797);
  assert.equal(evidence.variable.session_stdout.body_bytes, 30);
  assert.equal(evidence.variable.session_stdout.body.status, "deployment_failed");
  assert.equal(evidence.variable.reread_stdout.body_bytes, 13);
  assert.equal(evidence.variable.reread_stdout.body.status, "");
  assert.equal(evidence.zero_sha_probe.reread_stdout.body.status, "");
  const text = JSON.stringify(evidence);
  assert.equal(text.includes(SENTINEL), false);
  assert.equal(text.includes("eyJ"), false);
  assert.equal(text.includes("Bearer "), false);
});
