import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDuplicateConflict } from "./duplicate-conflicting-records.js";

const rec = (name, type, content, id) => ({ name, type, content, id });

test("flags CNAME with A record at same name", () => {
  const records = [
    rec("app.example.com", "CNAME", "app.hosting-provider.net", "r1"),
    rec("app.example.com", "A", "203.0.113.9", "r2"),
  ];
  const result = detectDuplicateConflict(records);
  assert.equal(result.conflict, true);
  assert.equal(result.reason, "cname_coexistence");
  assert.deepEqual(result.toRemove, ["r2"]);
});

test("round robin A records are not a conflict", () => {
  const records = [
    rec("www.example.com", "A", "203.0.113.10", "r1"),
    rec("www.example.com", "A", "203.0.113.11", "r2"),
  ];
  const expectedIps = ["203.0.113.10", "203.0.113.11"];
  const result = detectDuplicateConflict(records, expectedIps);
  assert.equal(result.conflict, false);
});

test("flags stale IP among duplicate A records", () => {
  const records = [
    rec("www.example.com", "A", "203.0.113.10", "r1"),
    rec("www.example.com", "A", "198.51.100.77", "r2"),
  ];
  const expectedIps = ["203.0.113.10"];
  const result = detectDuplicateConflict(records, expectedIps);
  assert.equal(result.conflict, true);
  assert.equal(result.reason, "ambiguous_duplicate_ip");
  assert.deepEqual(result.toRemove, ["r2"]);
});

test("clean zone has no conflict", () => {
  const records = [
    rec("www.example.com", "CNAME", "www.hosting-provider.net", "r1"),
    rec("example.com", "A", "203.0.113.10", "r2"),
    rec("example.com", "MX", "mail.example.com", "r3"),
  ];
  assert.equal(detectDuplicateConflict(records).conflict, false);
});

test("lone A record is not a conflict", () => {
  const records = [rec("sub.example.com", "A", "203.0.113.10", "r1")];
  assert.equal(detectDuplicateConflict(records).conflict, false);
});
