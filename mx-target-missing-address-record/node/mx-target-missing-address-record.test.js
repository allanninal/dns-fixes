import { test } from "node:test";
import assert from "node:assert/strict";
import { findDanglingMxTargets } from "./mx-target-missing-address-record.js";

test("no dangling when every target has an address", () => {
  const targets = ["mail.example.com"];
  const resolved = { "mail.example.com": ["203.0.113.25"] };
  assert.deepEqual(findDanglingMxTargets(targets, resolved), []);
});

test("flags target with empty address list", () => {
  const targets = ["mail.example.com"];
  const resolved = { "mail.example.com": [] };
  assert.deepEqual(findDanglingMxTargets(targets, resolved), ["mail.example.com"]);
});

test("flags target missing from the mapping", () => {
  const targets = ["mail.example.com"];
  const resolved = {};
  assert.deepEqual(findDanglingMxTargets(targets, resolved), ["mail.example.com"]);
});

test("preserves order and dedupes", () => {
  const targets = ["b.example.com", "a.example.com", "b.example.com"];
  const resolved = { "a.example.com": [], "b.example.com": [] };
  assert.deepEqual(findDanglingMxTargets(targets, resolved), ["b.example.com", "a.example.com"]);
});

test("mixed targets only flags the broken one", () => {
  const targets = ["good.example.com", "bad.example.com"];
  const resolved = { "good.example.com": ["203.0.113.1"], "bad.example.com": [] };
  assert.deepEqual(findDanglingMxTargets(targets, resolved), ["bad.example.com"]);
});
