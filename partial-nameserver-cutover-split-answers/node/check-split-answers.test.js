import { test } from "node:test";
import assert from "node:assert/strict";
import { diffNameserverAnswers } from "./check-split-answers.js";

test("agreement returns empty", () => {
  const nsRecords = {
    "lena.ns.cloudflare.com": { A: ["198.51.100.9"], TXT: ["v=spf1 ~all"] },
    "walt.ns.cloudflare.com": { A: ["198.51.100.9"], TXT: ["v=spf1 ~all"] },
  };
  assert.deepEqual(diffNameserverAnswers(nsRecords), {});
});

test("flags the stale nameserver", () => {
  const nsRecords = {
    "ns1.oldhost.com": { A: ["203.0.113.5"], TXT: ["v=spf1 ~all"] },
    "lena.ns.cloudflare.com": { A: ["198.51.100.9"], TXT: ["v=spf1 ~all"] },
    "walt.ns.cloudflare.com": { A: ["198.51.100.9"], TXT: ["v=spf1 ~all"] },
  };
  const result = diffNameserverAnswers(nsRecords);
  assert.deepEqual(result.A, ["ns1.oldhost.com"]);
  assert.equal(result.TXT, undefined);
});

test("missing record counts as a mismatch", () => {
  const nsRecords = {
    "ns1.oldhost.com": { TXT: [] },
    "lena.ns.cloudflare.com": { TXT: ["v=spf1 include:_spf.google.com ~all"] },
    "walt.ns.cloudflare.com": { TXT: ["v=spf1 include:_spf.google.com ~all"] },
  };
  const result = diffNameserverAnswers(nsRecords);
  assert.deepEqual(result.TXT, ["ns1.oldhost.com"]);
});

test("single nameserver has nothing to compare", () => {
  const nsRecords = { "lena.ns.cloudflare.com": { A: ["198.51.100.9"] } };
  assert.deepEqual(diffNameserverAnswers(nsRecords), {});
});

test("all disagree picks a majority by count", () => {
  const nsRecords = {
    "a.ns.com": { A: ["1.1.1.1"] },
    "b.ns.com": { A: ["1.1.1.1"] },
    "c.ns.com": { A: ["2.2.2.2"] },
  };
  const result = diffNameserverAnswers(nsRecords);
  assert.deepEqual(result.A, ["c.ns.com"]);
});
