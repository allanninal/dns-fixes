import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDmarcPolicy } from "./dmarc-policy-check.js";

const RECORD = "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com; pct=100";

test("null when already past none", () => {
  const record = "v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc-reports@example.com";
  assert.equal(nextDmarcPolicy(record, 200, 0.99), null);
});

test("null when too soon since last change", () => {
  assert.equal(nextDmarcPolicy(RECORD, 30, 0.99), null);
});

test("null when alignment too low", () => {
  assert.equal(nextDmarcPolicy(RECORD, 200, 0.80), null);
});

test("bumps to quarantine when safe", () => {
  const result = nextDmarcPolicy(RECORD, 200, 0.99);
  assert.match(result, /p=quarantine/);
  assert.match(result, /pct=25/);
});
