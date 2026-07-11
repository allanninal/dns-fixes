import { test } from "node:test";
import assert from "node:assert/strict";
import { isDanglingWildcard } from "./dangling-wildcard.js";

const VULN = new Set(["no such app", "nosuchbucket"]);

const wildcardRecord = (over = {}) => ({
  name: "*.example.com",
  type: "CNAME",
  content: "old-app.paas.net",
  ...over,
});

test("dangling when target is nxdomain", () => {
  assert.equal(isDanglingWildcard(wildcardRecord(), "NXDOMAIN", null, VULN), true);
});

test("dangling when target is servfail", () => {
  assert.equal(isDanglingWildcard(wildcardRecord(), "SERVFAIL", null, VULN), true);
});

test("dangling when fingerprint matches known vulnerable", () => {
  assert.equal(isDanglingWildcard(wildcardRecord(), "OK", "no such app", VULN), true);
});

test("not dangling when target ok and fingerprint unknown", () => {
  assert.equal(isDanglingWildcard(wildcardRecord(), "OK", "welcome home", VULN), false);
});

test("not dangling when not a wildcard name", () => {
  const record = wildcardRecord({ name: "shop.example.com" });
  assert.equal(isDanglingWildcard(record, "NXDOMAIN", null, VULN), false);
});

test("not dangling when not cname type", () => {
  const record = wildcardRecord({ type: "A" });
  assert.equal(isDanglingWildcard(record, "NXDOMAIN", null, VULN), false);
});
