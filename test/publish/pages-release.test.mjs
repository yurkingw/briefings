import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ackOnce } from "../../lib/publish/contents-api.js";
import { toPublicEnvelope } from "../../lib/publish/envelope.js";
import { planInbox } from "../../lib/publish/inbox.js";
import { stageReady, verifyReady } from "../../lib/publish/ready.js";
import { selectPagesArtifact } from "../../lib/pages-artifact.js";
import { deployFromActions } from "../../scripts/briefings-pages-deploy.mjs";
import { PagesDeployError } from "../../lib/pages-deploy.js";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD = "e12b11e21fdea75f9a73bdc042ab81977c8e4bb6";
const DELETED = "14992589679";
const UPLOADED = "15015326107";

function packed(overrides) {
  const staged = stageReady(tempRoot(), dailyRaw({ date: "2026-11-25", ...overrides }));
  return toPublicEnvelope(verifyReady(staged.readyPath));
}

function item(body, remote) {
  return {
    path: body.path,
    blobSha: "316e5e9de6bed2175adef51a4c3687409e217e51",
    contentHash: body.envelope.content_hash,
    payloadSha256: body.envelope.payload_sha256,
    updatedAtMs: body.updatedAtMs,
    payloadBytes: body.payloadBytes,
    contentPath: `content/daily/${body.envelope.period}.json`,
    period: body.envelope.period,
    schema: body.envelope.schema,
    remote,
  };
}

test("a same-day noon publish replaces only that day and deploys the new upload id", async () => {
  const morning = packed({ updated_at: "2026-11-25T08:00:00+08:00", wave: "晨间" });
  const noon = packed({ updated_at: "2026-11-25T12:56:28+08:00", wave: "午间" });
  assert.notEqual(morning.envelope.content_hash, noon.envelope.content_hash);
  const first = planInbox({
    event: "push",
    triggerSha: "morning",
    originMain: "morning-tip",
    inbox: [item(morning)],
  });
  assert.equal(first.reason, "publish");
  const second = planInbox({
    event: "push",
    triggerSha: "noon",
    originMain: "after-morning",
    inbox: [item(noon, {
      contentHash: morning.envelope.content_hash,
      updatedAtMs: morning.updatedAtMs,
      payloadSha256: morning.envelope.payload_sha256,
    })],
  });
  const files = {
    "content/daily/2026-11-24.json": Buffer.from("yesterday-stays"),
    "content/daily/2026-11-25.json": morning.payloadBytes,
  };
  for (const write of second.writes) files[write.path] = write.bytes;
  assert.equal(files["content/daily/2026-11-24.json"].toString(), "yesterday-stays");
  assert.equal(files["content/daily/2026-11-25.json"].equals(noon.payloadBytes), true);
  assert.equal(JSON.stringify(second).includes(DELETED), false);

  const listed = selectPagesArtifact([{ name: "github-pages", id: Number(DELETED) }]);
  assert.equal(String(listed.id), DELETED);
  const calls = [];
  let attempt = 0;
  const request = async (method, route, body) => {
    calls.push({ method, route, body });
    assert.equal(route.includes("artifacts"), false);
    assert.equal(route.includes("ListArtifacts"), false);
    if (body && body.artifact_id !== undefined) assert.equal(body.artifact_id, Number(UPLOADED));
    attempt += method === "POST" && route.endsWith("/pages/deployments") ? 1 : 0;
    if (method === "POST" && route.endsWith("/pages/deployments") && attempt === 1) {
      return { status: 400, body: { message: "Unable to find artifact mathching the id" } };
    }
    if (method === "POST") return { status: 200, body: { id: BUILD, status: "deployment_in_progress" } };
    return { status: 200, body: { status: "succeed", page_url: "https://yurkingw.github.io/briefings/" } };
  };
  const removed = [];
  const transport = {
    async get() {
      return {
        blobSha: "316e5e9de6bed2175adef51a4c3687409e217e51",
        bytes: Buffer.from(JSON.stringify({ content_hash: noon.envelope.content_hash })),
      };
    },
    async remove(path) {
      removed.push(path);
    },
  };
  await assert.rejects(
    () => deployFromActions({
      artifactId: UPLOADED,
      buildVersion: BUILD,
      repository: "yurkingw/briefings",
      getIdToken: async () => "oidc-present",
      sleep: async () => {},
      request,
    }),
    (error) => error instanceof PagesDeployError && error.code === "create_rejected",
  );
  assert.equal(removed.length, 0);
  await deployFromActions({
    artifactId: UPLOADED,
    buildVersion: BUILD,
    repository: "yurkingw/briefings",
    getIdToken: async () => "oidc-present",
    sleep: async () => {},
    request,
  });
  const acked = await ackOnce({
    item: {
      path: noon.path,
      blobSha: "316e5e9de6bed2175adef51a4c3687409e217e51",
      contentHash: noon.envelope.content_hash,
      period: noon.envelope.period,
    },
    transport,
  });
  assert.equal(acked.deleted, true);
  assert.deepEqual(removed, [noon.path]);
  const repeat = planInbox({
    event: "push",
    triggerSha: BUILD,
    originMain: BUILD,
    inbox: [item(noon, {
      contentHash: noon.envelope.content_hash,
      updatedAtMs: noon.updatedAtMs,
      payloadSha256: noon.envelope.payload_sha256,
    })],
  });
  assert.equal(repeat.reason, "unchanged");
  assert.equal(repeat.deploy, true);
  assert.equal(repeat.writes.length, 0);
  assert.equal(repeat.contentSha, BUILD);
});

test("the workflow deploy job has no list fallback and no invalid observation", () => {
  const yaml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
  const deploy = yaml.slice(yaml.indexOf("\n  deploy:\n"), yaml.indexOf("\n  ack:\n"));
  assert.equal(deploy.includes("actions/deploy-pages@"), false);
  assert.equal(deploy.includes("briefings-pages-artifact-observe"), false);
  assert.equal(deploy.includes("listArtifacts"), false);
  assert.match(deploy, /ARTIFACT_ID: \$\{\{ steps\.pages-artifact\.outputs\.artifact-id \}\}/);
  assert.match(deploy, /artifactId,/);
  assert.equal(deploy.includes("actions: write"), false);
  assert.match(yaml, /needs\.deploy\.result == 'success' && needs\.process\.outputs\.ack == 'true'/);
  assert.equal(fs.existsSync(path.join(repo, "scripts/briefings-pages-artifact-observe.sh")), false);
});
