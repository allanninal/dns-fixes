import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSpfRecords } from "./duplicate-spf-records.js";

test("empty list returns null", () => {
  assert.equal(mergeSpfRecords([]), null);
});

test("single record returned unchanged", () => {
  const record = "v=spf1 include:_spf.google.com ~all";
  assert.equal(mergeSpfRecords([record]), record);
});

test("two different includes are merged", () => {
  const records = [
    "v=spf1 include:_spf.google.com ~all",
    "v=spf1 include:sendgrid.net -all",
  ];
  const result = mergeSpfRecords(records);
  assert.ok(result.startsWith("v=spf1 "));
  assert.ok(result.includes("include:_spf.google.com"));
  assert.ok(result.includes("include:sendgrid.net"));
  assert.ok(result.endsWith("-all"));
});

test("overlapping includes are deduplicated", () => {
  const records = [
    "v=spf1 include:_spf.google.com ~all",
    "v=spf1 include:_spf.google.com include:sendgrid.net -all",
  ];
  const result = mergeSpfRecords(records);
  assert.equal(result.split("include:_spf.google.com").length - 1, 1);
  assert.ok(result.includes("include:sendgrid.net"));
});

test("prefers stricter all qualifier", () => {
  const records = [
    "v=spf1 include:_spf.google.com ~all",
    "v=spf1 include:sendgrid.net -all",
  ];
  const result = mergeSpfRecords(records);
  assert.ok(result.endsWith("-all"));
  assert.ok(!result.endsWith("~all"));
});
