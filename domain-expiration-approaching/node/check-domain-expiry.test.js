import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntilExpiry } from "./check-domain-expiry.js";

test("ok when plenty of runway", () => {
  const result = daysUntilExpiry("2026-09-15T00:00:00Z", "2026-08-01T00:00:00Z");
  assert.equal(result.severity, "ok");
  assert.equal(result.triggeredThreshold, null);
  assert.equal(result.daysRemaining, 45);
});

test("warning at thirty day boundary", () => {
  const result = daysUntilExpiry("2026-08-31T00:00:00Z", "2026-08-01T00:00:00Z");
  assert.equal(result.daysRemaining, 30);
  assert.equal(result.severity, "warning");
  assert.equal(result.triggeredThreshold, 30);
});

test("warning inside fourteen day window", () => {
  const result = daysUntilExpiry("2026-08-10T00:00:00Z", "2026-08-01T00:00:00Z");
  assert.equal(result.daysRemaining, 9);
  assert.equal(result.severity, "warning");
  assert.equal(result.triggeredThreshold, 14);
});

test("critical at seven day boundary", () => {
  const result = daysUntilExpiry("2026-08-08T00:00:00Z", "2026-08-01T00:00:00Z");
  assert.equal(result.daysRemaining, 7);
  assert.equal(result.severity, "critical");
  assert.equal(result.triggeredThreshold, 7);
});

test("critical one day left", () => {
  const result = daysUntilExpiry("2026-08-02T00:00:00Z", "2026-08-01T00:00:00Z");
  assert.equal(result.daysRemaining, 1);
  assert.equal(result.severity, "critical");
  assert.equal(result.triggeredThreshold, 1);
});

test("expired when negative", () => {
  const result = daysUntilExpiry("2026-07-25T00:00:00Z", "2026-08-01T00:00:00Z");
  assert.equal(result.daysRemaining, -7);
  assert.equal(result.severity, "expired");
  assert.equal(result.triggeredThreshold, null);
});

test("custom thresholds", () => {
  const result = daysUntilExpiry("2026-08-21T00:00:00Z", "2026-08-01T00:00:00Z", [60, 20, 5]);
  assert.equal(result.daysRemaining, 20);
  assert.equal(result.severity, "warning");
  assert.equal(result.triggeredThreshold, 20);
});
