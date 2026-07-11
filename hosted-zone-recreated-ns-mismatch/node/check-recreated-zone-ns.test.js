import { test } from "node:test";
import assert from "node:assert/strict";
import { nsSetsMatch } from "./check-recreated-zone-ns.js";

test("matches when identical", () => {
  assert.equal(nsSetsMatch(["ns1.example.com"], ["ns1.example.com"]), true);
});

test("matches ignoring case", () => {
  assert.equal(nsSetsMatch(["NS-321.AWSDNS-40.COM"], ["ns-321.awsdns-40.com"]), true);
});

test("matches ignoring trailing dot", () => {
  assert.equal(nsSetsMatch(["ns-321.awsdns-40.com."], ["ns-321.awsdns-40.com"]), true);
});

test("matches ignoring order", () => {
  const a = ["ns-321.awsdns-40.com", "ns-1054.awsdns-04.org"];
  const b = ["ns-1054.awsdns-04.org", "ns-321.awsdns-40.com"];
  assert.equal(nsSetsMatch(a, b), true);
});

test("mismatch on recreated zone vs stale registrar", () => {
  const newZone = ["ns-321.awsdns-40.com", "ns-1054.awsdns-04.org"];
  const oldRegistrar = ["ns-1.awsdns-00.com", "ns-2.awsdns-00.net"];
  assert.equal(nsSetsMatch(newZone, oldRegistrar), false);
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
