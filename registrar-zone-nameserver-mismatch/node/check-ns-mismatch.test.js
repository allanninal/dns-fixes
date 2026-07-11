import { test } from "node:test";
import assert from "node:assert/strict";
import { nsSetsMatch } from "./check-ns-mismatch.js";

test("matches when identical", () => {
  assert.equal(nsSetsMatch(["ns1.example.com"], ["ns1.example.com"]), true);
});

test("matches ignoring case", () => {
  assert.equal(nsSetsMatch(["NS1.EXAMPLE.COM"], ["ns1.example.com"]), true);
});

test("matches ignoring trailing dot", () => {
  assert.equal(nsSetsMatch(["ns1.example.com."], ["ns1.example.com"]), true);
});

test("matches ignoring order", () => {
  const a = ["bob.ns.cloudflare.com", "kate.ns.cloudflare.com"];
  const b = ["kate.ns.cloudflare.com", "bob.ns.cloudflare.com"];
  assert.equal(nsSetsMatch(a, b), true);
});

test("mismatch on old vs new host", () => {
  const oldNs = ["ns1.oldhost.com", "ns2.oldhost.com"];
  const newNs = ["bob.ns.cloudflare.com", "kate.ns.cloudflare.com"];
  assert.equal(nsSetsMatch(oldNs, newNs), false);
});

test("mismatch when one list has an extra server", () => {
  const a = ["ns1.example.com", "ns2.example.com"];
  const b = ["ns1.example.com", "ns2.example.com", "ns3.example.com"];
  assert.equal(nsSetsMatch(a, b), false);
});

test("mismatch when one list is missing a server", () => {
  const a = ["ns1.example.com", "ns2.example.com"];
  const b = ["ns1.example.com"];
  assert.equal(nsSetsMatch(a, b), false);
});

test("both empty counts as matching", () => {
  assert.equal(nsSetsMatch([], []), true);
});

test("one empty one not is a mismatch", () => {
  assert.equal(nsSetsMatch([], ["ns1.example.com"]), false);
});
