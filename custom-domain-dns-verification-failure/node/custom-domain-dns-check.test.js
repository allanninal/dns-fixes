import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnosePagesDns, GITHUB_PAGES_A_RECORDS } from "./custom-domain-dns-check.js";

test("all ok when records match", () => {
  const report = diagnosePagesDns(GITHUB_PAGES_A_RECORDS, "yourusername.github.io", GITHUB_PAGES_A_RECORDS, ".github.io");
  assert.equal(report.apex_ok, true);
  assert.equal(report.www_ok, true);
});

test("apex missing ips reported", () => {
  const partial = new Set(["185.199.108.153", "185.199.109.153"]);
  const report = diagnosePagesDns(partial, "yourusername.github.io", GITHUB_PAGES_A_RECORDS, ".github.io");
  assert.equal(report.apex_ok, false);
  assert.deepEqual([...report.apex_missing].sort(), ["185.199.110.153", "185.199.111.153"]);
});

test("apex extra ip reported", () => {
  const extraSet = new Set([...GITHUB_PAGES_A_RECORDS, "203.0.113.10"]);
  const report = diagnosePagesDns(extraSet, "yourusername.github.io", GITHUB_PAGES_A_RECORDS, ".github.io");
  assert.equal(report.apex_ok, false);
  assert.deepEqual([...report.apex_extra], ["203.0.113.10"]);
});

test("www wrong target reported", () => {
  const report = diagnosePagesDns(GITHUB_PAGES_A_RECORDS, "old-host.example.net", GITHUB_PAGES_A_RECORDS, ".github.io");
  assert.equal(report.www_ok, false);
});

test("www missing reported", () => {
  const report = diagnosePagesDns(GITHUB_PAGES_A_RECORDS, null, GITHUB_PAGES_A_RECORDS, ".github.io");
  assert.equal(report.www_ok, false);
});
