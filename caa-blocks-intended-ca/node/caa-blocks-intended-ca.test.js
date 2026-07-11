import { test } from "node:test";
import assert from "node:assert/strict";
import { caaPermitsCa } from "./caa-blocks-intended-ca.js";

test("no CAA records permits any CA", () => {
  const [permitted] = caaPermitsCa([], "letsencrypt.org");
  assert.equal(permitted, true);
});

test("matching issue record permits", () => {
  const [permitted] = caaPermitsCa([["issue", "letsencrypt.org"]], "letsencrypt.org");
  assert.equal(permitted, true);
});

test("mismatched issue record blocks", () => {
  const [permitted, reason] = caaPermitsCa([["issue", "digicert.com"]], "letsencrypt.org");
  assert.equal(permitted, false);
  assert.match(reason, /no issue record names letsencrypt.org/);
});

test("empty issue record blocks everyone", () => {
  const [permitted, reason] = caaPermitsCa([["issue", ";"]], "letsencrypt.org");
  assert.equal(permitted, false);
  assert.match(reason, /empty/);
});

test("wildcard falls back to issue when no issuewild", () => {
  const [permitted] = caaPermitsCa([["issue", "letsencrypt.org"]], "letsencrypt.org", true);
  assert.equal(permitted, true);
});

test("wildcard uses issuewild when present", () => {
  const records = [["issue", "letsencrypt.org"], ["issuewild", "digicert.com"]];
  const [permitted, reason] = caaPermitsCa(records, "letsencrypt.org", true);
  assert.equal(permitted, false);
  assert.match(reason, /issuewild/);
});

test("accounturi suffix is ignored for CA name match", () => {
  const records = [["issue", "letsencrypt.org;accounturi=https://acme-v02.api.letsencrypt.org/acme/acct/1"]];
  const [permitted] = caaPermitsCa(records, "letsencrypt.org");
  assert.equal(permitted, true);
});

test("no relevant tag present permits", () => {
  const [permitted] = caaPermitsCa([["iodef", "mailto:security@example.com"]], "letsencrypt.org");
  assert.equal(permitted, true);
});
