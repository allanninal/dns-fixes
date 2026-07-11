import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntilExpiry, classify } from "./check-tls-expiry.js";

test("days until expiry, future date", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const notAfter = new Date("2026-02-15T00:00:00Z");
  assert.equal(daysUntilExpiry(notAfter, now), 45);
});

test("days until expiry, past date", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const notAfter = new Date("2025-12-29T00:00:00Z");
  assert.equal(daysUntilExpiry(notAfter, now), -3);
});

test("classify ok when plenty of runway", () => {
  assert.equal(classify(60), "ok");
});

test("classify warn at boundary", () => {
  assert.equal(classify(21, 21, 7), "warn");
});

test("classify warn just inside window", () => {
  assert.equal(classify(15, 21, 7), "warn");
});

test("classify critical at boundary", () => {
  assert.equal(classify(7, 21, 7), "critical");
});

test("classify critical just inside window", () => {
  assert.equal(classify(2, 21, 7), "critical");
});

test("classify expired when negative", () => {
  assert.equal(classify(-1), "expired");
});

test("classify expired many days past", () => {
  assert.equal(classify(-30), "expired");
});
