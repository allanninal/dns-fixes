import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseWwwApex } from "./www-apex-mismatch.js";

test("ok when both resolve to same ips", () => {
  const ips = new Set(["185.199.108.153", "185.199.109.153"]);
  assert.equal(diagnoseWwwApex(ips, null, ips, null), "ok");
});

test("apex missing when apex has nothing", () => {
  const wwwIps = new Set(["185.199.108.153"]);
  assert.equal(diagnoseWwwApex(new Set(), null, wwwIps, null), "apex_missing");
});

test("www missing when www has nothing", () => {
  const apexIps = new Set(["185.199.108.153"]);
  assert.equal(diagnoseWwwApex(apexIps, null, new Set(), null), "www_missing");
});

test("both missing when neither resolves", () => {
  assert.equal(diagnoseWwwApex(new Set(), null, new Set(), null), "both_missing");
});

test("ip mismatch when disjoint ip sets", () => {
  const apexIps = new Set(["34.102.136.180"]);
  const wwwIps = new Set(["185.199.108.153"]);
  assert.equal(diagnoseWwwApex(apexIps, null, wwwIps, null), "ip_mismatch");
});

test("ok when apex uses cname alias only", () => {
  const wwwIps = new Set(["185.199.108.153"]);
  assert.equal(diagnoseWwwApex(new Set(), "www.example.com", wwwIps, null), "ok");
});
