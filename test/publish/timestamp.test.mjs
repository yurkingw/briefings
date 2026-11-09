import assert from "node:assert/strict";
import test from "node:test";
import { parseUpdatedAt } from "../../lib/publish/timestamp.js";

test("accepts an offset timestamp and compares instants", () => {
  const east = parseUpdatedAt("2026-11-10T08:00:00+08:00");
  const utc = parseUpdatedAt("2026-11-10T00:00:00+00:00");
  assert.equal(east.instantMs, utc.instantMs);
  assert.equal(east.raw, "2026-11-10T08:00:00+08:00");
});

test("rejects illegal timestamp forms and values", () => {
  for (const value of [
    "",
    null,
    "2026-11-10",
    "2026-11-10T08:00:00Z",
    "2026-11-10T08:00:00+08",
    "2026-11-10T08:00:00+08:00 ",
    "2026-11-10T08:00:00.000+08:00",
    "2026-13-01T00:00:00+08:00",
    "2026-11-10T24:00:00+08:00",
    "2026-11-10T08:60:00+08:00",
    "2026-11-10T08:00:60+08:00",
    "2026-02-29T00:00:00+08:00",
    "2026-11-10T08:00:00+14:30",
    "2026-11-10T08:00:00-13:00",
  ]) {
    assert.throws(() => parseUpdatedAt(value), (error) => error.exit === 10 && error.result === "bad_timestamp");
  }
});

test("accepts a real leap day and the offset bounds", () => {
  assert.equal(typeof parseUpdatedAt("2028-02-29T00:00:00+08:00").instantMs, "number");
  assert.equal(typeof parseUpdatedAt("2026-11-10T08:00:00+14:00").instantMs, "number");
  assert.equal(typeof parseUpdatedAt("2026-11-10T08:00:00-12:00").instantMs, "number");
});
