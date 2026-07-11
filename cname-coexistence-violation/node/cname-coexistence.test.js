import { test } from "node:test";
import assert from "node:assert/strict";
import { findCnameCoexistenceViolations } from "./cname-coexistence.js";

const rec = (name, type, id) => ({ name, type, id });

test("flags CNAME with TXT at same name", () => {
  const records = [rec("app.example.com", "CNAME", "r1"), rec("app.example.com", "TXT", "r2")];
  const violations = findCnameCoexistenceViolations(records);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].name, "app.example.com");
  assert.deepEqual(violations[0].conflictingIds, ["r2"]);
  assert.deepEqual(violations[0].types, ["TXT"]);
});

test("flags CNAME with multiple other types", () => {
  const records = [
    rec("sub.example.com", "CNAME", "r1"),
    rec("sub.example.com", "A", "r2"),
    rec("sub.example.com", "MX", "r3"),
  ];
  const violations = findCnameCoexistenceViolations(records);
  assert.equal(violations.length, 1);
  assert.deepEqual([...violations[0].conflictingIds].sort(), ["r2", "r3"]);
  assert.deepEqual([...violations[0].types].sort(), ["A", "MX"]);
});

test("clean zone has no violations", () => {
  const records = [
    rec("www.example.com", "CNAME", "r1"),
    rec("example.com", "A", "r2"),
    rec("example.com", "MX", "r3"),
  ];
  assert.deepEqual(findCnameCoexistenceViolations(records), []);
});

test("name matching is case insensitive", () => {
  const records = [rec("App.Example.com", "CNAME", "r1"), rec("app.example.com", "A", "r2")];
  const violations = findCnameCoexistenceViolations(records);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].conflictingIds, ["r2"]);
});

test("lone CNAME is not a violation", () => {
  const records = [rec("sub.example.com", "CNAME", "r1")];
  assert.deepEqual(findCnameCoexistenceViolations(records), []);
});

test("empty records returns no violations", () => {
  assert.deepEqual(findCnameCoexistenceViolations([]), []);
});
