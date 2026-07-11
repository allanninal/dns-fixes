import { test } from "node:test";
import assert from "node:assert/strict";
import { countSpfLookups } from "./spf-exceeds-lookup-limit.js";

function makeResolver(table) {
  return (_kind, name) => table[name] || [];
}

test("no lookups when only ip4", () => {
  const [total, warnings] = countSpfLookups("v=spf1 ip4:203.0.113.0/24 -all", makeResolver({}));
  assert.equal(total, 0);
  assert.deepEqual(warnings, []);
});

test("single include with no nesting", () => {
  const table = { "sendgrid.net": ["v=spf1 ip4:198.51.100.0/24 ~all"] };
  const [total] = countSpfLookups("v=spf1 include:sendgrid.net ~all", makeResolver(table));
  assert.equal(total, 1);
});

test("nested includes are counted recursively", () => {
  const table = {
    "_spf.google.com": ["v=spf1 include:_netblocks.google.com include:_netblocks2.google.com ~all"],
    "_netblocks.google.com": ["v=spf1 ip4:35.190.247.0/24 ~all"],
    "_netblocks2.google.com": ["v=spf1 ip4:64.233.160.0/19 ~all"],
  };
  const [total] = countSpfLookups("v=spf1 include:_spf.google.com ~all", makeResolver(table));
  assert.equal(total, 3);
});

test("exceeding ten produces a warning", () => {
  const includes = Array.from({ length: 11 }, (_, i) => `include:v${i}.example.com`).join(" ");
  const table = {};
  for (let i = 0; i < 11; i++) table[`v${i}.example.com`] = [`v=spf1 ip4:203.0.113.${i}/32 -all`];
  const [total, warnings] = countSpfLookups(`v=spf1 ${includes} ~all`, makeResolver(table));
  assert.equal(total, 11);
  assert.ok(warnings.some((w) => w.includes("exceeds 10-lookup limit (11 found)")));
});

test("void lookup is reported", () => {
  const [total, warnings] = countSpfLookups("v=spf1 include:missing.example.com ~all", makeResolver({}));
  assert.equal(total, 1);
  assert.ok(warnings.some((w) => w.includes("void lookup")));
});

test("redirect modifier counts and recurses", () => {
  const table = { "relay.example.com": ["v=spf1 ip4:203.0.113.9/32 -all"] };
  const [total] = countSpfLookups("v=spf1 redirect=relay.example.com", makeResolver(table));
  assert.equal(total, 1);
});
