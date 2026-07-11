import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTtlRisk } from "./ttl-too-low.js";

test("low TTL with high traffic is risky", () => {
  const result = assessTtlRisk(60, 500000);
  assert.equal(result.risky, true);
  assert.ok(result.estimatedQps > 5.0);
});

test("normal TTL with low traffic is not risky", () => {
  const result = assessTtlRisk(3600, 1000);
  assert.equal(result.risky, false);
});

test("TTL below min safe is risky even with low traffic", () => {
  const result = assessTtlRisk(30, 100);
  assert.equal(result.risky, true);
});

test("recommended TTL comes from the ladder", () => {
  const result = assessTtlRisk(60, 500000);
  assert.ok([60, 120, 300, 900, 3600, 86400].includes(result.recommendedTtl));
});

test("recommended TTL brings QPS under the threshold", () => {
  const result = assessTtlRisk(60, 100000, 5.0);
  assert.ok(100000 / result.recommendedTtl <= 5.0);
});

test("zero TTL does not divide by zero", () => {
  const result = assessTtlRisk(0, 1000);
  assert.equal(result.estimatedQps, 1000);
  assert.equal(result.risky, true);
});
