import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRenewal } from "./auto-renewal-payment-failure.js";

test("ok when date moved forward and far out", () => {
  const result = evaluateRenewal("2027-08-05T00:00:00Z", "2026-08-05T00:00:00Z", "2026-07-11T00:00:00Z", []);
  assert.equal(result.stalled, false);
  assert.equal(result.paymentLikelyFailed, false);
});

test("stalled and inside window flags failure", () => {
  const result = evaluateRenewal("2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z", "2026-07-20T00:00:00Z", []);
  assert.equal(result.stalled, true);
  assert.equal(result.paymentLikelyFailed, true);
});

test("stalled but far from window is not yet a failure", () => {
  const result = evaluateRenewal("2027-08-05T00:00:00Z", "2027-08-05T00:00:00Z", "2026-07-11T00:00:00Z", []);
  assert.equal(result.stalled, true);
  assert.equal(result.paymentLikelyFailed, false);
});

test("grace period status always flags failure", () => {
  const result = evaluateRenewal("2027-08-05T00:00:00Z", null, "2026-07-11T00:00:00Z", ["autoRenewPeriod"]);
  assert.equal(result.inGracePeriod, true);
  assert.equal(result.paymentLikelyFailed, true);
});

test("no previous expiration defaults to not stalled", () => {
  const result = evaluateRenewal("2026-07-20T00:00:00Z", null, "2026-07-11T00:00:00Z", []);
  assert.equal(result.stalled, false);
  assert.equal(result.paymentLikelyFailed, false);
});

test("redemption period status flags failure", () => {
  const result = evaluateRenewal("2026-07-05T00:00:00Z", "2026-07-05T00:00:00Z", "2026-07-11T00:00:00Z", ["redemptionPeriod"]);
  assert.equal(result.inGracePeriod, true);
  assert.equal(result.paymentLikelyFailed, true);
});

test("custom warn days threshold", () => {
  const result = evaluateRenewal("2026-08-10T00:00:00Z", "2026-08-10T00:00:00Z", "2026-07-11T00:00:00Z", [], 45);
  assert.equal(result.stalled, true);
  assert.equal(result.paymentLikelyFailed, true);
});
