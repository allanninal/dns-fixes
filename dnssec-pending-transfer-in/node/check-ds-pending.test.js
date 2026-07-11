import { test } from "node:test";
import assert from "node:assert/strict";
import { dsState } from "./check-ds-pending.js";

test("ok when digest matches", () => {
  assert.equal(dsState("abc123", true, ["abc123", "def456"], 100.0), "ok");
});

test("not signed when nothing published anywhere", () => {
  assert.equal(dsState(null, false, [], 100.0), "not_signed");
});

test("pending ok within threshold", () => {
  assert.equal(dsState("abc123", true, ["def456"], 10.0), "pending_ok");
});

test("stuck pending beyond threshold", () => {
  assert.equal(dsState("abc123", true, ["def456"], 72.0), "stuck_pending");
});

test("stuck pending when parent has no DS at all", () => {
  assert.equal(dsState("abc123", true, [], 72.0), "stuck_pending");
});

test("orphaned DS when parent has DS but child has nothing", () => {
  assert.equal(dsState(null, false, ["abc123"], 72.0), "orphaned_ds");
});

test("custom threshold is respected", () => {
  assert.equal(dsState("abc123", true, ["def456"], 30.0, 24.0), "stuck_pending");
  assert.equal(dsState("abc123", true, ["def456"], 30.0, 48.0), "pending_ok");
});
