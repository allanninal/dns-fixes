import { test } from "node:test";
import assert from "node:assert/strict";
import { staleNegativeCacheReport } from "./stale-negative-cache.js";

test("detects stale resolver when authoritative is fixed", () => {
  const results = { "8.8.8.8": ["NXDOMAIN", 2143], "1.1.1.1": ["NOERROR", 299] };
  const report = staleNegativeCacheReport(3600, 2143, results, true);
  assert.equal(report.isStaleNegativeCache, true);
  assert.deepEqual(report.staleResolvers, ["8.8.8.8"]);
  assert.equal(report.etaSeconds["8.8.8.8"], 2143);
  assert.equal(report.maxWaitSeconds, 2143);
});

test("not stale when authoritative still missing", () => {
  const results = { "8.8.8.8": ["NXDOMAIN", 2143] };
  const report = staleNegativeCacheReport(3600, 2143, results, false);
  assert.equal(report.isStaleNegativeCache, false);
  assert.deepEqual(report.staleResolvers, []);
});

test("no stale resolvers when all agree", () => {
  const results = { "8.8.8.8": ["NOERROR", 300], "1.1.1.1": ["NOERROR", 300] };
  const report = staleNegativeCacheReport(3600, 0, results, true);
  assert.equal(report.isStaleNegativeCache, false);
  assert.equal(report.maxWaitSeconds, 0);
});

test("negative ttl is clamped to zero", () => {
  const results = { "9.9.9.9": ["NXDOMAIN", -5] };
  const report = staleNegativeCacheReport(3600, -5, results, true);
  assert.equal(report.etaSeconds["9.9.9.9"], 0);
});

test("multiple stale resolvers report max wait", () => {
  const results = {
    "8.8.8.8": ["NXDOMAIN", 2143],
    "9.9.9.9": ["NXDOMAIN", 3500],
    "1.1.1.1": ["NOERROR", 299],
  };
  const report = staleNegativeCacheReport(3600, 3500, results, true);
  assert.deepEqual(report.staleResolvers.sort(), ["8.8.8.8", "9.9.9.9"]);
  assert.equal(report.maxWaitSeconds, 3500);
});
