import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { planInbox } from "../../lib/publish/inbox.js";
import { toPublicEnvelope } from "../../lib/publish/envelope.js";
import { stageReady, verifyReady } from "../../lib/publish/ready.js";
import {
  PAGES_ARTIFACT_NAME,
  artifactsAfterUpload,
  selectPagesArtifact,
} from "../../lib/pages-artifact.js";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function packed() {
  const staged = stageReady(tempRoot(), dailyRaw());
  return toPublicEnvelope(verifyReady(staged.readyPath));
}

test("deploy-pages rejects zero or several artifacts with the pinned messages", () => {
  assert.throws(
    () => selectPagesArtifact([]),
    /No artifacts named "github-pages" were found for this workflow run/,
  );
  assert.throws(
    () => selectPagesArtifact([
      {name: PAGES_ARTIFACT_NAME, id: 14976294744},
      {name: PAGES_ARTIFACT_NAME, id: 14984057270},
    ]),
    /Multiple artifacts named "github-pages" were unexpectedly found for this workflow run\. Artifact count is 2/,
  );
});

test("a rerun without overwrite keeps both github-pages artifacts", () => {
  const after = artifactsAfterUpload(
    [{name: PAGES_ARTIFACT_NAME, id: 1, digest: "old"}],
    {overwrite: false, uploaded: {id: 2, digest: "new"}},
  );
  assert.throws(() => selectPagesArtifact(after), /Artifact count is 2/);
});

test("overwrite leaves exactly one github-pages artifact for deploy-pages", () => {
  const after = artifactsAfterUpload(
    [{name: PAGES_ARTIFACT_NAME, id: 1, digest: "old"}, {name: "other", id: 9}],
    {overwrite: true, uploaded: {id: 2, digest: "new"}},
  );
  const selected = selectPagesArtifact(after);
  assert.equal(selected.id, 2);
  assert.equal(selected.name, "github-pages");
  assert.equal(after.filter((item) => item.name === "other").length, 1);
  const stillTwo = artifactsAfterUpload(
    [
      {name: PAGES_ARTIFACT_NAME, id: 1},
      {name: PAGES_ARTIFACT_NAME, id: 2},
    ],
    {overwrite: true, uploaded: {id: 3, digest: "third"}},
  );
  assert.throws(() => selectPagesArtifact(stillTwo), /Artifact count is 2/);
});

test("pages workflow uploads and deploys the same artifact name", () => {
  const yaml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
  const deploy = yaml.slice(yaml.indexOf("\n  deploy:\n"), yaml.indexOf("\n  ack:\n"));
  const uploadAt = deploy.indexOf("actions/upload-artifact@");
  const deployAt = deploy.indexOf("actions/deploy-pages@");
  assert.ok(uploadAt >= 0 && deployAt > uploadAt);
  const upload = deploy.slice(uploadAt, deployAt);
  const pagesDeploy = deploy.slice(deployAt);
  assert.match(upload, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(upload, /name: github-pages/);
  assert.match(upload, /overwrite: true/);
  assert.match(pagesDeploy, /actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/);
  assert.match(pagesDeploy, /artifact_name: github-pages/);
  assert.match(deploy, /test "\$tip" = "\$\{\{ needs\.process\.outputs\.content_sha \}\}"/);
  assert.equal(deploy.includes("actions: write"), false);
  const ack = yaml.slice(yaml.indexOf("\n  ack:\n"));
  assert.match(ack, /needs\.deploy\.result == 'success' && needs\.process\.outputs\.ack == 'true'/);
});

test("an identical inbox still deploys and does not rewrite the payload", () => {
  const body = packed();
  const again = planInbox({
    event: "push",
    triggerSha: "inbox",
    originMain: "content",
    inbox: [{
      path: body.path,
      blobSha: "same",
      contentHash: body.envelope.content_hash,
      payloadSha256: body.envelope.payload_sha256,
      updatedAtMs: body.updatedAtMs,
      payloadBytes: body.payloadBytes,
      contentPath: `content/daily/${body.envelope.period}.json`,
      period: body.envelope.period,
      schema: body.envelope.schema,
      remote: {
        contentHash: body.envelope.content_hash,
        updatedAtMs: body.updatedAtMs,
        payloadSha256: body.envelope.payload_sha256,
      },
    }],
  });
  assert.equal(again.exit, 0);
  assert.equal(again.reason, "unchanged");
  assert.equal(again.deploy, true);
  assert.equal(again.writes.length, 0);
  assert.equal(again.ack.length, 1);
  assert.equal(again.ack[0].disposition, "unchanged");
  assert.equal(again.contentSha, "content");
});
