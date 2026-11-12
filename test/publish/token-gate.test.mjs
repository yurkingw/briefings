import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { machineResult } from "../../lib/publish/result.js";
import { classifyPublishToken, readPublishToken } from "../../lib/publish/token.js";
import { stageReady, verifyReady } from "../../lib/publish/ready.js";
import { main as publishMain } from "../../scripts/briefings-publish.mjs";
import { main as uploadMain } from "../../scripts/briefings-upload.mjs";
import { dailyRaw, tempRoot } from "./fixtures.mjs";

const FAKE_TOKEN = "test-only-not-a-credential";
const OTHER_TOKEN = "other-name-not-a-credential";
const INVALID_TEXT = "zz-sentinel-not-usable!!";
const INVALID_NUMBER = 918273645019283746;
const OBJECT_MARKER = "object-secret-marker";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function capture() {
  const out = [];
  const err = [];
  return {
    stdout: { write(chunk) { out.push(String(chunk)); } },
    stderr: { write(chunk) { err.push(String(chunk)); } },
    text() { return out.join(""); },
    errText() { return err.join(""); },
  };
}

function stage() {
  const staged = stageReady(tempRoot(), dailyRaw());
  const verified = verifyReady(staged.readyPath);
  return {
    readyPath: staged.readyPath,
    schema: verified.schema,
    period: verified.period,
    contentHash: verified.contentHash,
  };
}

function historical(body) {
  return {
    result: body.result,
    exit: body.exit,
    reason: body.reason,
    attempts: body.attempts,
    schema: body.schema,
    period: body.period,
    content_hash: body.content_hash,
  };
}

function assertNoSecret(text, secret) {
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes(sha256(secret)), false);
  for (const key of ["token", "value", "length", "sha256", "hash"]) {
    assert.equal(text.includes(`"${key}"`), false);
  }
}

async function runUpload(env, fetchImpl) {
  const staged = stage();
  const io = capture();
  let calls = 0;
  const exit = await uploadMain(["--ready", staged.readyPath, "--receipt-dir", tempRoot()], {
    env,
    stdout: io.stdout,
    stderr: io.stderr,
    fetchImpl: async (...args) => {
      calls += 1;
      if (!fetchImpl) throw new Error("fetch should not run");
      return fetchImpl(...args);
    },
  });
  const text = io.text();
  assert.equal(io.errText(), text);
  assert.equal(text.endsWith("\n"), true);
  assert.equal(text.trim().split("\n").length, 1);
  return { exit, body: JSON.parse(text), text, calls, staged };
}

test("classifier reports presence and category without the value", () => {
  const cases = [
    [{}, false, "absent"],
    [{ BRIEFINGS_PUBLISH_TOKEN: "" }, true, "empty"],
    [{ BRIEFINGS_PUBLISH_TOKEN: "   " }, true, "invalid_charset"],
    [{ BRIEFINGS_PUBLISH_TOKEN: INVALID_TEXT }, true, "invalid_charset"],
    [{ BRIEFINGS_PUBLISH_TOKEN: INVALID_NUMBER }, true, "invalid_type"],
    [{ BRIEFINGS_PUBLISH_TOKEN: { leak: OBJECT_MARKER } }, true, "invalid_type"],
    [{ BRIEFINGS_PUBLISH_TOKEN: FAKE_TOKEN }, true, "usable"],
  ];
  for (const [env, present, category] of cases) {
    const gate = classifyPublishToken(env);
    assert.deepEqual(Object.keys(gate).sort(), ["category", "present"]);
    assert.equal(gate.present, present);
    assert.equal(gate.category, category);
    const encoded = JSON.stringify(gate);
    assert.equal(encoded.includes(INVALID_TEXT), false);
    assert.equal(encoded.includes(OBJECT_MARKER), false);
    assert.equal(encoded.includes(String(INVALID_NUMBER)), false);
    assert.equal(encoded.includes(FAKE_TOKEN), false);
    assert.equal(encoded.includes(sha256(INVALID_TEXT)), false);
  }
  const absent = classifyPublishToken({
    GITHUB_TOKEN: OTHER_TOKEN,
    GH_TOKEN: OTHER_TOKEN,
  });
  assert.deepEqual(absent, { present: false, category: "absent" });
  assert.equal(JSON.stringify(absent).includes(OTHER_TOKEN), false);
  const inherited = Object.create({ BRIEFINGS_PUBLISH_TOKEN: FAKE_TOKEN });
  assert.deepEqual(classifyPublishToken(inherited), { present: false, category: "absent" });
  assert.equal(readPublishToken(inherited), "");
  assert.equal(readPublishToken({ BRIEFINGS_PUBLISH_TOKEN: FAKE_TOKEN }), FAKE_TOKEN);
});

test("machine result keeps historical keys and drops raw token diagnostics", () => {
  assert.deepEqual(machineResult({
    result: "adapter_disabled",
    reason: "adapter_disabled",
    exit: 50,
    attempts: 0,
    schema: "qianji.briefing.daily.v1",
    period: "2026-11-10",
    content_hash: "ab",
  }), {
    result: "adapter_disabled",
    exit: 50,
    schema: "qianji.briefing.daily.v1",
    period: "2026-11-10",
    content_hash: "ab",
    attempts: 0,
    reason: "adapter_disabled",
  });
  const leaked = machineResult({
    result: "adapter_disabled",
    exit: 50,
    attempts: 0,
    reason: "adapter_disabled",
    config_phase: INVALID_TEXT,
    token_present: INVALID_TEXT,
    token_category: INVALID_TEXT,
    token: INVALID_TEXT,
    value: INVALID_TEXT,
    length: INVALID_TEXT.length,
  });
  assert.equal(JSON.stringify(leaked).includes(INVALID_TEXT), false);
  assert.equal(Object.hasOwn(leaked, "token"), false);
  assert.equal(Object.hasOwn(leaked, "value"), false);
  assert.equal(Object.hasOwn(leaked, "length"), false);
  assert.equal(Object.hasOwn(leaked, "config_phase"), false);
  assert.equal(Object.hasOwn(leaked, "token_present"), false);
  assert.equal(Object.hasOwn(leaked, "token_category"), false);
  const safe = machineResult({
    result: "adapter_disabled",
    exit: 50,
    attempts: 0,
    reason: "adapter_disabled",
    config_phase: "pre_http",
    token_present: false,
    token_category: "absent",
  });
  assert.equal(safe.config_phase, "pre_http");
  assert.equal(safe.token_present, false);
  assert.equal(safe.token_category, "absent");
});

test("absent token matches the pre-HTTP receipt signal and does not call fetch", async () => {
  const outcome = await runUpload({}, null);
  assert.equal(outcome.exit, 50);
  assert.equal(outcome.calls, 0);
  assert.deepEqual(historical(outcome.body), {
    result: "adapter_disabled",
    exit: 50,
    reason: "adapter_disabled",
    attempts: 0,
    schema: outcome.staged.schema,
    period: outcome.staged.period,
    content_hash: outcome.staged.contentHash,
  });
  assert.equal(outcome.staged.schema, "qianji.briefing.daily.v1");
  assert.equal(outcome.staged.period, "2026-11-10");
  assert.equal(Object.hasOwn(outcome.body, "updated_at"), false);
  assert.equal(outcome.body.config_phase, "pre_http");
  assert.equal(outcome.body.token_present, false);
  assert.equal(outcome.body.token_category, "absent");
  assert.deepEqual(Object.keys(outcome.body), [
    "result",
    "exit",
    "schema",
    "period",
    "content_hash",
    "attempts",
    "reason",
    "config_phase",
    "token_present",
    "token_category",
  ]);
});

test("empty and rejected values stay pre-HTTP and omit the raw text", async () => {
  const empty = await runUpload({ BRIEFINGS_PUBLISH_TOKEN: "" }, null);
  assert.equal(empty.exit, 50);
  assert.equal(empty.calls, 0);
  assert.equal(empty.body.result, "adapter_disabled");
  assert.equal(empty.body.attempts, 0);
  assert.equal(empty.body.config_phase, "pre_http");
  assert.equal(empty.body.token_present, true);
  assert.equal(empty.body.token_category, "empty");

  const charset = await runUpload({ BRIEFINGS_PUBLISH_TOKEN: INVALID_TEXT }, null);
  assert.equal(charset.exit, 50);
  assert.equal(charset.calls, 0);
  assert.equal(charset.body.token_present, true);
  assert.equal(charset.body.token_category, "invalid_charset");
  assert.equal(charset.body.config_phase, "pre_http");
  assertNoSecret(charset.text, INVALID_TEXT);

  const typed = await runUpload({ BRIEFINGS_PUBLISH_TOKEN: INVALID_NUMBER }, null);
  assert.equal(typed.calls, 0);
  assert.equal(typed.body.token_category, "invalid_type");
  assert.equal(typed.body.token_present, true);
  assert.equal(typed.text.includes(String(INVALID_NUMBER)), false);

  const marker = await runUpload({ BRIEFINGS_PUBLISH_TOKEN: { leak: OBJECT_MARKER } }, null);
  assert.equal(marker.calls, 0);
  assert.equal(marker.body.token_category, "invalid_type");
  assert.equal(marker.text.includes(OBJECT_MARKER), false);

  const otherNames = await runUpload({
    GITHUB_TOKEN: OTHER_TOKEN,
    GH_TOKEN: OTHER_TOKEN,
  }, null);
  assert.equal(otherNames.exit, 50);
  assert.equal(otherNames.calls, 0);
  assert.equal(otherNames.body.token_category, "absent");
  assert.equal(otherNames.body.token_present, false);
  assert.equal(otherNames.text.includes(OTHER_TOKEN), false);
});

function jsonResponse(status, payload) {
  return {
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("mocked transport success stays attempts 1 and emits no token diagnostic", async () => {
  let stored = null;
  const outcome = await runUpload({ BRIEFINGS_PUBLISH_TOKEN: FAKE_TOKEN }, async (url, init) => {
    assert.equal(String(url).startsWith("https://api.github.com/repos/yurkingw/briefings/contents/"), true);
    assert.equal(init.headers.authorization, `Bearer ${FAKE_TOKEN}`);
    if (init.method === "GET" && !stored) return jsonResponse(404, { message: "Not Found" });
    if (init.method === "PUT") {
      stored = Buffer.from(JSON.parse(init.body).content, "base64");
      return jsonResponse(201, { content: { sha: "blob-1" } });
    }
    if (init.method === "GET") {
      return jsonResponse(200, { sha: "blob-1", content: stored.toString("base64") });
    }
    throw new Error("unexpected request");
  });
  assert.equal(outcome.exit, 0);
  assert.equal(outcome.calls, 3);
  assert.deepEqual(historical(outcome.body), {
    result: "uploaded",
    exit: 0,
    reason: "uploaded",
    attempts: 1,
    schema: outcome.staged.schema,
    period: outcome.staged.period,
    content_hash: outcome.staged.contentHash,
  });
  assert.equal(Object.hasOwn(outcome.body, "config_phase"), false);
  assert.equal(Object.hasOwn(outcome.body, "token_present"), false);
  assert.equal(Object.hasOwn(outcome.body, "token_category"), false);
  assert.equal(outcome.text.includes(FAKE_TOKEN), false);
  assert.equal(outcome.text.includes("Bearer"), false);
});

test("HTTP rejection stays distinct from the pre-HTTP gate", async () => {
  const forbidden = await runUpload({ BRIEFINGS_PUBLISH_TOKEN: FAKE_TOKEN }, async () => jsonResponse(403, { message: "no" }));
  assert.equal(forbidden.exit, 40);
  assert.equal(forbidden.calls, 1);
  assert.deepEqual(historical(forbidden.body), {
    result: "transport_forbidden",
    exit: 40,
    reason: "transport_forbidden",
    attempts: 1,
    schema: forbidden.staged.schema,
    period: forbidden.staged.period,
    content_hash: forbidden.staged.contentHash,
  });
  assert.equal(Object.hasOwn(forbidden.body, "config_phase"), false);
  assert.equal(Object.hasOwn(forbidden.body, "token_present"), false);
  assert.equal(Object.hasOwn(forbidden.body, "token_category"), false);
  assert.equal(forbidden.text.includes(FAKE_TOKEN), false);

  const absent = await runUpload({}, null);
  assert.notEqual(absent.body.exit, forbidden.body.exit);
  assert.notEqual(absent.body.result, forbidden.body.result);
  assert.equal(absent.body.attempts, 0);
  assert.equal(forbidden.body.attempts, 1);
  assert.equal(absent.body.config_phase, "pre_http");
});

test("the local publish command does not read the token or add token diagnostics", async () => {
  const io = capture();
  const exit = await publishMain(["--ready", stage().readyPath, "--receipt-dir", tempRoot()], {
    stdout: io.stdout,
    stderr: io.stderr,
    env: { BRIEFINGS_PUBLISH_TOKEN: FAKE_TOKEN },
  });
  const body = JSON.parse(io.text());
  assert.equal(exit, 50);
  assert.equal(body.result, "adapter_disabled");
  assert.equal(body.reason, "adapter_disabled");
  assert.equal(body.attempts, 0);
  assert.equal(Object.hasOwn(body, "config_phase"), false);
  assert.equal(Object.hasOwn(body, "token_present"), false);
  assert.equal(Object.hasOwn(body, "token_category"), false);
  assert.equal(io.text().includes(FAKE_TOKEN), false);
});
