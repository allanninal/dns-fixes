import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseCaaDnssecBreak } from "./caa-lookup-servfail-dnssec.js";

test("ok when no SERVFAIL", () => {
  assert.equal(diagnoseCaaDnssecBreak(false, true, true, false), "ok");
});

test("not dnssec related when +cd also fails", () => {
  assert.equal(diagnoseCaaDnssecBreak(true, false, true, false), "not_dnssec_related");
});

test("ds mismatch when digests disagree", () => {
  assert.equal(diagnoseCaaDnssecBreak(true, true, false, false), "broken_dnssec_chain_ds_mismatch");
});

test("expired rrsig takes priority", () => {
  assert.equal(diagnoseCaaDnssecBreak(true, true, true, true), "broken_dnssec_chain_expired_rrsig");
});

test("expired rrsig even if ds also mismatches", () => {
  assert.equal(diagnoseCaaDnssecBreak(true, true, false, true), "broken_dnssec_chain_expired_rrsig");
});

test("ds matches and no expiry still flags break", () => {
  assert.equal(diagnoseCaaDnssecBreak(true, true, true, false), "broken_dnssec_chain_ds_mismatch");
});
