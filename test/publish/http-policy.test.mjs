import assert from "node:assert/strict";
import test from "node:test";
import { publishReadyFile } from "../../lib/publish/cas.js";
import { stageReady } from "../../lib/publish/ready.js";
import {
  createGithubGitDataTransport,
  createInjectedGitDataTransport,
} from "../../lib/publish/transport/github-git-data.js";
import { isInjectedTestTransport } from "../../lib/publish/transport/injected.js";
import { main } from "../../scripts/briefings-publish.mjs";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

function response(status, text) {
  return {
    status,
    async text() {
      return text;
    },
  };
}

function countingFetch(status, text) {
  let calls = 0;
  return {
    calls: () => calls,
    fetchImpl: async () => {
      calls += 1;
      return response(status, text);
    },
  };
}

async function runInjected(fetchImpl) {
  const transport = createInjectedGitDataTransport(fetchImpl);
  assert.equal(isInjectedTestTransport(transport), true);
  assert.equal(transport.production, false);
  return publishReadyFile({
    readyPath: stageReady(tempRoot(), dailyRaw()).readyPath,
    transport,
    receiptDir: tempRoot(),
    lockTimeoutMs: 1000,
  });
}

test("the production factory ignores fetch and stays disabled", async () => {
  let calls = 0;
  const transport = createGithubGitDataTransport({
    fetchImpl: async () => {
      calls += 1;
      return response(200, "{}");
    },
  });
  assert.equal(isInjectedTestTransport(transport), false);
  const outcome = await publishReadyFile({
    readyPath: stageReady(tempRoot(), dailyRaw()).readyPath,
    transport,
    receiptDir: tempRoot(),
  });
  assert.equal(outcome.exit, 50);
  assert.equal(outcome.body.result, "adapter_disabled");
  assert.equal(outcome.body.reason, "adapter_disabled");
  assert.equal(Object.hasOwn(outcome.body, "enabled"), false);
  assert.equal(calls, 0);
});

test("an unfenced transport cannot be turned on through the command", async () => {
  let calls = 0;
  const chunks = [];
  const exit = await main(["--ready", stageReady(tempRoot(), dailyRaw()).readyPath, "--receipt-dir", tempRoot()], {
    stdout: { write(chunk) { chunks.push(String(chunk)); } },
    stderr: { write() {} },
    transport: {
      enabled: true,
      async fetchState() {
        calls += 1;
        return { commitSha: "base", treeSha: "tree", file: null };
      },
      async publish() {
        calls += 1;
        return { commitSha: "next" };
      },
    },
  });
  assert.equal(exit, 50);
  assert.equal(calls, 0);
  const body = JSON.parse(chunks.join(""));
  assert.equal(body.reason, "adapter_disabled");
  assert.equal(JSON.stringify(body).includes("enabled"), false);
});

test("a non-JSON success body retries and exits 40", async () => {
  const http = countingFetch(200, "not-json");
  const outcome = await runInjected(http.fetchImpl);
  assert.equal(outcome.exit, 40);
  assert.equal(outcome.body.result, "transport_exhausted");
  assert.equal(outcome.body.reason, "transport_exhausted");
  assert.equal(outcome.body.attempts, 3);
  assert.equal(http.calls(), 3);
});

test("permission failures are not retried", async () => {
  const http = countingFetch(403, "<html>forbidden</html>");
  const outcome = await runInjected(http.fetchImpl);
  assert.equal(outcome.exit, 40);
  assert.equal(outcome.body.result, "transport_forbidden");
  assert.equal(outcome.body.reason, "transport_forbidden");
  assert.equal(outcome.body.attempts, 1);
  assert.equal(http.calls(), 1);
});

test("server errors retry then stop", async () => {
  const http = countingFetch(502, "<html>down</html>");
  const outcome = await runInjected(http.fetchImpl);
  assert.equal(outcome.exit, 40);
  assert.equal(outcome.body.result, "transport_exhausted");
  assert.equal(outcome.body.attempts, 3);
  assert.equal(http.calls(), 3);
});
