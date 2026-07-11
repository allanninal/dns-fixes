import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction } from "./check-record-ownership.js";

const intended = (over = {}) => ({
  name: "app.example.com", type: "A", content: "203.0.113.10", owner: "team-a", ...over,
});

test("create when no live record", () => {
  assert.equal(decideAction(intended(), null, "team-a"), "create");
});

test("noop when owned and matching", () => {
  const live = { name: "app.example.com", type: "A", content: "203.0.113.10", comment: "managed-by:team-a" };
  assert.equal(decideAction(intended(), live, "team-a"), "noop");
});

test("update when owned and content differs", () => {
  const live = { name: "app.example.com", type: "A", content: "198.51.100.5", comment: "managed-by:team-a" };
  assert.equal(decideAction(intended(), live, "team-a"), "update");
});

test("skip_conflict when owner differs", () => {
  const live = { name: "app.example.com", type: "A", content: "198.51.100.5", comment: "managed-by:team-b" };
  assert.equal(decideAction(intended(), live, "team-a"), "skip_conflict");
});

test("skip_conflict when no ownership marker", () => {
  const live = { name: "app.example.com", type: "A", content: "198.51.100.5", comment: null };
  assert.equal(decideAction(intended(), live, "team-a"), "skip_conflict");
});

test("skip_conflict when comment missing managed-by prefix", () => {
  const live = { name: "app.example.com", type: "A", content: "198.51.100.5", comment: "hand added by ops" };
  assert.equal(decideAction(intended(), live, "team-a"), "skip_conflict");
});

test("noop ignores owner field on intended record", () => {
  const live = { name: "app.example.com", type: "A", content: "203.0.113.10", comment: "managed-by:team-a" };
  assert.equal(decideAction(intended({ owner: "team-z" }), live, "team-a"), "noop");
});
