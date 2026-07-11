import { test } from "node:test";
import assert from "node:assert/strict";
import { findStaleChallengeRecords } from "./stale-acme-challenge-record.js";

const NOW = 1_700_000_000;

function record(id, content, ageSeconds) {
  return { id, content, modified_on: NOW - ageSeconds };
}

test("no stale when single fresh record matches token", () => {
  const records = [record("r1", "fresh-token", 30)];
  assert.deepEqual(findStaleChallengeRecords(records, "fresh-token", NOW), []);
});

test("flags record older than timeout regardless of content", () => {
  const records = [record("r1", "old-token", 7200)];
  assert.deepEqual(findStaleChallengeRecords(records, null, NOW, 3600), ["r1"]);
});

test("flags mismatched token past grace period", () => {
  const records = [record("r1", "old-token", 600)];
  assert.deepEqual(findStaleChallengeRecords(records, "fresh-token", NOW), ["r1"]);
});

test("does not flag mismatched token within grace period", () => {
  const records = [record("r1", "old-token", 60)];
  assert.deepEqual(findStaleChallengeRecords(records, "fresh-token", NOW), []);
});

test("mixed set flags only the stale one", () => {
  const records = [record("r1", "fresh-token", 30), record("r2", "old-token", 10800)];
  assert.deepEqual(findStaleChallengeRecords(records, "fresh-token", NOW), ["r2"]);
});

test("no current token only uses timeout", () => {
  const records = [record("r1", "anything", 300)];
  assert.deepEqual(findStaleChallengeRecords(records, null, NOW, 3600), []);
});

test("empty records returns empty list", () => {
  assert.deepEqual(findStaleChallengeRecords([], "fresh-token", NOW), []);
});
