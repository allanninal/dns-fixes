import { test } from "node:test";
import assert from "node:assert/strict";
import { isDelegationMissing } from "./check-delegation.js";

test("missing when parent has nothing", () => {
  assert.equal(isDelegationMissing([], ["ns1.cloudflare.com", "ns2.cloudflare.com"], true), true);
});

test("missing when parent and child disagree", () => {
  const parent = ["ns1.oldhost.com"];
  const child = ["ns1.cloudflare.com", "ns2.cloudflare.com"];
  assert.equal(isDelegationMissing(parent, child, true), true);
});

test("ok when parent and child agree", () => {
  const parent = ["ns1.cloudflare.com", "ns2.cloudflare.com"];
  const child = ["ns1.cloudflare.com", "ns2.cloudflare.com"];
  assert.equal(isDelegationMissing(parent, child, true), false);
});

test("ok when sets partially overlap", () => {
  const parent = ["ns1.cloudflare.com", "ns3.oldhost.com"];
  const child = ["ns1.cloudflare.com", "ns2.cloudflare.com"];
  assert.equal(isDelegationMissing(parent, child, true), false);
});

test("not a problem when child not configured", () => {
  assert.equal(isDelegationMissing([], [], false), false);
});

test("not a problem when child soa present but no ns", () => {
  assert.equal(isDelegationMissing(["ns1.oldhost.com"], [], true), false);
});
