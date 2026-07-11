import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTtl } from "./ttl-too-high.js";

test("low TTL is safe", () => {
  assert.equal(classifyTtl(300, 3600), "safe");
});

test("TTL at threshold is safe", () => {
  assert.equal(classifyTtl(3600, 3600), "safe");
});

test("TTL above threshold is high", () => {
  assert.equal(classifyTtl(86400, 3600), "high_ttl");
});

test("automatic TTL of one is safe", () => {
  assert.equal(classifyTtl(1, 3600), "safe");
});

test("missing TTL is safe", () => {
  assert.equal(classifyTtl(null, 3600), "safe");
});

test("custom threshold is respected", () => {
  assert.equal(classifyTtl(1800, 900), "high_ttl");
  assert.equal(classifyTtl(600, 900), "safe");
});
