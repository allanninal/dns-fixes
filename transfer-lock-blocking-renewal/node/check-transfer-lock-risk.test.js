import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTransferRisk } from "./check-transfer-lock-risk.js";

const NOW = new Date("2026-07-11T00:00:00Z");

test("at risk when locked and within window", () => {
  const expiration = new Date("2026-08-05T00:00:00Z");
  const result = assessTransferRisk(["clientTransferProhibited", "active"], expiration, NOW, 30);
  assert.equal(result.locked, true);
  assert.equal(result.daysUntilExpiry, 25);
  assert.equal(result.atRisk, true);
});

test("not at risk when unlocked", () => {
  const expiration = new Date("2026-08-05T00:00:00Z");
  const result = assessTransferRisk(["active"], expiration, NOW, 30);
  assert.equal(result.locked, false);
  assert.equal(result.atRisk, false);
});

test("not at risk when locked but far from expiry", () => {
  const expiration = new Date("2027-01-01T00:00:00Z");
  const result = assessTransferRisk(["clientTransferProhibited"], expiration, NOW, 30);
  assert.equal(result.locked, true);
  assert.equal(result.atRisk, false);
});

test("not at risk when already expired", () => {
  const expiration = new Date("2026-07-01T00:00:00Z");
  const result = assessTransferRisk(["clientTransferProhibited"], expiration, NOW, 30);
  assert.equal(result.daysUntilExpiry, -10);
  assert.equal(result.atRisk, false);
});

test("serverTransferProhibited also counts as locked", () => {
  const expiration = new Date("2026-07-20T00:00:00Z");
  const result = assessTransferRisk(["serverTransferProhibited"], expiration, NOW, 30);
  assert.equal(result.locked, true);
  assert.equal(result.atRisk, true);
});

test("status normalization is case and space insensitive", () => {
  const expiration = new Date("2026-07-25T00:00:00Z");
  const result = assessTransferRisk(["Client Transfer Prohibited"], expiration, NOW, 30);
  assert.equal(result.locked, true);
});
