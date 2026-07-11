import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCnameTarget } from "./dangling-cname-takeover.js";

test("ok when target resolves and answers normally", () => {
  const status = { resolves: true, httpStatus: 200, bodySnippet: "welcome to our site" };
  assert.equal(classifyCnameTarget(status), "ok");
});

test("dangling when target does not resolve", () => {
  const status = { resolves: false, httpStatus: null, bodySnippet: "" };
  assert.equal(classifyCnameTarget(status), "dangling");
});

test("dangling when body matches unclaimed signature", () => {
  const status = { resolves: true, httpStatus: 404, bodySnippet: "There isn't a GitHub Pages site here." };
  assert.equal(classifyCnameTarget(status), "dangling");
});

test("unknown when status is missing", () => {
  assert.equal(classifyCnameTarget(null), "unknown");
});
