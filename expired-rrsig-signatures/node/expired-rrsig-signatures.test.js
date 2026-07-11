import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRrsigExpiration } from "./expired-rrsig-signatures.js";

const NOW = new Date("2026-07-11T12:00:00Z");

test("ok when expiration far in future", () => {
  const expiration = new Date(NOW.getTime() + 10 * 24 * 3600000);
  assert.equal(checkRrsigExpiration(expiration, NOW, 48), "ok");
});

test("expiring soon within warn window", () => {
  const expiration = new Date(NOW.getTime() + 12 * 3600000);
  assert.equal(checkRrsigExpiration(expiration, NOW, 48), "expiring_soon");
});

test("expired when expiration already passed", () => {
  const expiration = new Date(NOW.getTime() - 3600000);
  assert.equal(checkRrsigExpiration(expiration, NOW, 48), "expired");
});

test("expired exactly at boundary", () => {
  assert.equal(checkRrsigExpiration(NOW, NOW, 48), "expired");
});

test("not expiring soon just outside warn window", () => {
  const expiration = new Date(NOW.getTime() + 49 * 3600000);
  assert.equal(checkRrsigExpiration(expiration, NOW, 48), "ok");
});
