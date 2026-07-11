import { test } from "node:test";
import assert from "node:assert/strict";
import { fqdnLabels, resolveZoneForChallenge } from "./resolve-acme-zone.js";

const LABELS = fqdnLabels("_acme-challenge.www.sub.example.com");

test("resolves to parent when only parent has soa and api zone", () => {
  const soa = { "www.sub.example.com": false, "sub.example.com": false, "example.com": true, com: false };
  const apiZones = new Set(["example.com"]);
  assert.equal(resolveZoneForChallenge(LABELS, soa, apiZones), "example.com");
});

test("resolves to delegated subdomain when registered", () => {
  const soa = { "www.sub.example.com": false, "sub.example.com": true, "example.com": true, com: false };
  const apiZones = new Set(["sub.example.com"]);
  assert.equal(resolveZoneForChallenge(LABELS, soa, apiZones), "sub.example.com");
});

test("null when soa apex not in provider account", () => {
  const soa = { "www.sub.example.com": false, "sub.example.com": true, "example.com": true, com: false };
  const apiZones = new Set(["example.com"]);
  assert.equal(resolveZoneForChallenge(LABELS, soa, apiZones), null);
});

test("null when no level ever answers with soa", () => {
  const soa = { "www.sub.example.com": false, "sub.example.com": false, "example.com": false, com: false };
  const apiZones = new Set(["example.com"]);
  assert.equal(resolveZoneForChallenge(LABELS, soa, apiZones), null);
});

test("stops at the first suffix with soa, not a later one", () => {
  const soa = { "www.sub.example.com": false, "sub.example.com": true, "example.com": true, com: false };
  const apiZones = new Set(["example.com", "sub.example.com"]);
  assert.equal(resolveZoneForChallenge(LABELS, soa, apiZones), "sub.example.com");
});

test("empty provider zone set is always null", () => {
  const soa = { "www.sub.example.com": false, "sub.example.com": false, "example.com": true, com: false };
  assert.equal(resolveZoneForChallenge(LABELS, soa, new Set()), null);
});
