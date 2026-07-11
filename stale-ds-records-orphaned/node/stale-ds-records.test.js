import { test } from "node:test";
import assert from "node:assert/strict";
import { findStaleDs } from "./stale-ds-records.js";

const ds = (over = {}) => ({ keyTag: 2371, algorithm: 13, digestType: 2, digest: "3a1b9f", ...over });
const dnskey = (over = {}) => ({ keyTag: 2371, algorithm: 13, flags: 257, digest: "3a1b9f", ...over });

test("no stale when ds matches dnskey", () => {
  assert.deepEqual(findStaleDs([ds()], [dnskey()]), []);
});

test("flags ds with no matching dnskey", () => {
  const oldDs = ds({ keyTag: 55123, algorithm: 8, digest: "9c2e71" });
  const result = findStaleDs([ds(), oldDs], [dnskey()]);
  assert.deepEqual(result, [oldDs]);
});

test("flags all when no dnskeys present", () => {
  const oldDs = ds();
  assert.deepEqual(findStaleDs([oldDs], []), [oldDs]);
});

test("case insensitive digest comparison", () => {
  const upperDs = ds({ digest: "3A1B9F" });
  assert.deepEqual(findStaleDs([upperDs], [dnskey()]), []);
});
