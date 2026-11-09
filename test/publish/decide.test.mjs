import assert from "node:assert/strict";
import test from "node:test";
import { decidePublication } from "../../lib/publish/decide.js";

const local = { contentHash: "aaa", updatedAtMs: 1_000 };

test("missing remote publishes", () => {
  assert.deepEqual(decidePublication(local, null), {
    action: "publish",
    exit: 0,
    reason: "missing_remote",
  });
});

test("same hash and same instant is a noop", () => {
  assert.equal(decidePublication(local, { ...local }).action, "noop");
  assert.equal(decidePublication(local, { ...local }).reason, "identical");
});

test("same hash and newer stamp publishes the stamp", () => {
  const decision = decidePublication(
    { contentHash: "aaa", updatedAtMs: 2_000 },
    { contentHash: "aaa", updatedAtMs: 1_000 },
  );
  assert.equal(decision.action, "publish");
  assert.equal(decision.reason, "stamp_bump");
});

test("same hash and older stamp does not roll back", () => {
  const decision = decidePublication(local, { contentHash: "aaa", updatedAtMs: 2_000 });
  assert.equal(decision.action, "noop");
  assert.equal(decision.reason, "older_stamp_same_content");
  assert.equal(decision.exit, 0);
});

test("same instant and different hash conflicts", () => {
  const decision = decidePublication(local, { contentHash: "bbb", updatedAtMs: 1_000 });
  assert.equal(decision.action, "reject");
  assert.equal(decision.exit, 20);
  assert.equal(decision.reason, "conflict");
});

test("newer stamp and different hash publishes", () => {
  const decision = decidePublication(
    { contentHash: "bbb", updatedAtMs: 2_000 },
    { contentHash: "aaa", updatedAtMs: 1_000 },
  );
  assert.equal(decision.action, "publish");
  assert.equal(decision.reason, "replace");
});

test("older stamp and different hash is stale", () => {
  const decision = decidePublication(local, { contentHash: "bbb", updatedAtMs: 2_000 });
  assert.equal(decision.exit, 21);
  assert.equal(decision.reason, "stale");
});
