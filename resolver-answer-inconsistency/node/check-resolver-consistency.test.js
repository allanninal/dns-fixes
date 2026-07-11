import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseResolverInconsistency } from "./check-resolver-consistency.js";

test("consistent when every resolver matches", () => {
  const result = diagnoseResolverInconsistency(
    new Set(["203.0.113.10"]),
    new Map([["1.1.1.1", new Set(["203.0.113.10"])], ["8.8.8.8", new Set(["203.0.113.10"])]]),
    new Map([["1.1.1.1", 250], ["8.8.8.8", 300]]),
    300,
  );
  assert.equal(result.consistent, true);
  assert.deepEqual(result.staleResolvers, []);
  assert.equal(result.likelyCause, "none");
});

test("propagation lag with high ttl recommends lower ttl", () => {
  const result = diagnoseResolverInconsistency(
    new Set(["203.0.113.10"]),
    new Map([["1.1.1.1", new Set(["203.0.113.10"])], ["8.8.8.8", new Set(["198.51.100.5"])]]),
    new Map([["1.1.1.1", 100], ["8.8.8.8", 60000]]),
    86400,
  );
  assert.equal(result.consistent, false);
  assert.deepEqual(result.staleResolvers, ["8.8.8.8"]);
  assert.equal(result.likelyCause, "propagation_lag");
  assert.equal(result.recommendLowerTtl, true);
});

test("authoritative mismatch when expired ttl still disagrees", () => {
  const result = diagnoseResolverInconsistency(
    new Set(["203.0.113.10"]),
    new Map([["1.1.1.1", new Set(["198.51.100.5"])]]),
    new Map([["1.1.1.1", 2]]),
    300,
  );
  assert.equal(result.consistent, false);
  assert.equal(result.likelyCause, "authoritative_mismatch");
  assert.equal(result.recommendLowerTtl, false);
});

test("authoritative mismatch when all resolvers agree but differ from authoritative", () => {
  const result = diagnoseResolverInconsistency(
    new Set(["203.0.113.10"]),
    new Map([["1.1.1.1", new Set(["198.51.100.5"])], ["8.8.8.8", new Set(["198.51.100.5"])]]),
    new Map([["1.1.1.1", 200], ["8.8.8.8", 200]]),
    300,
  );
  assert.equal(result.consistent, false);
  assert.equal(result.likelyCause, "authoritative_mismatch");
  assert.equal(result.recommendLowerTtl, false);
});

test("propagation lag with low ttl does not recommend lower ttl", () => {
  const result = diagnoseResolverInconsistency(
    new Set(["203.0.113.10"]),
    new Map([["1.1.1.1", new Set(["203.0.113.10"])], ["8.8.8.8", new Set(["198.51.100.5"])]]),
    new Map([["1.1.1.1", 100], ["8.8.8.8", 250]]),
    300,
  );
  assert.equal(result.consistent, false);
  assert.equal(result.likelyCause, "propagation_lag");
  assert.equal(result.recommendLowerTtl, false);
});

test("missing ttl entry falls back to configured ttl", () => {
  // Missing TTL entries fall back to configuredTtl (not near-expired), but a
  // single stale resolver with none matching still reads as an
  // authoritative mismatch, since there is no other resolver corroborating
  // the authoritative answer.
  const result = diagnoseResolverInconsistency(
    new Set(["203.0.113.10"]),
    new Map([["1.1.1.1", new Set(["198.51.100.5"])]]),
    new Map(),
    86400,
  );
  assert.equal(result.consistent, false);
  assert.equal(result.likelyCause, "authoritative_mismatch");
  assert.equal(result.recommendLowerTtl, false);
});

test("propagation lag needs at least one matching resolver", () => {
  const result = diagnoseResolverInconsistency(
    new Set(["203.0.113.10"]),
    new Map([
      ["1.1.1.1", new Set(["203.0.113.10"])],
      ["8.8.8.8", new Set(["198.51.100.5"])],
      ["9.9.9.9", new Set(["198.51.100.5"])],
    ]),
    new Map([["1.1.1.1", 50], ["8.8.8.8", 60000], ["9.9.9.9", 60000]]),
    86400,
  );
  assert.equal(result.consistent, false);
  assert.deepEqual(new Set(result.staleResolvers), new Set(["8.8.8.8", "9.9.9.9"]));
  assert.equal(result.likelyCause, "propagation_lag");
  assert.equal(result.recommendLowerTtl, true);
});
