import { test } from "node:test";
import assert from "node:assert/strict";
import { wildcardCaaBlocked } from "./wildcard-caa-check.js";

test("blocked when issuewild names different ca", () => {
  const records = [[0, "issue", "letsencrypt.org"], [0, "issuewild", "sectigo.com"]];
  const [blocked, reason] = wildcardCaaBlocked(records, "letsencrypt.org");
  assert.equal(blocked, true);
  assert.match(reason, /sectigo\.com/);
});

test("blocked when issuewild denies all", () => {
  const records = [[0, "issue", "letsencrypt.org"], [0, "issuewild", ";"]];
  const [blocked, reason] = wildcardCaaBlocked(records, "letsencrypt.org");
  assert.equal(blocked, true);
  assert.match(reason, /deny all/);
});

test("not blocked when issuewild matches", () => {
  const records = [[0, "issue", "letsencrypt.org"], [0, "issuewild", "letsencrypt.org"]];
  const [blocked, reason] = wildcardCaaBlocked(records, "letsencrypt.org");
  assert.equal(blocked, false);
  assert.equal(reason, "");
});

test("not blocked when no issuewild present", () => {
  const records = [[0, "issue", "letsencrypt.org"]];
  const [blocked, reason] = wildcardCaaBlocked(records, "letsencrypt.org");
  assert.equal(blocked, false);
  assert.equal(reason, "");
});

test("not blocked when desired ca not in issue at all", () => {
  const records = [[0, "issue", "sectigo.com"], [0, "issuewild", "digicert.com"]];
  const [blocked, reason] = wildcardCaaBlocked(records, "letsencrypt.org");
  assert.equal(blocked, false);
  assert.equal(reason, "");
});

test("blocked checks all issuewild values", () => {
  const records = [
    [0, "issue", "letsencrypt.org"],
    [0, "issuewild", "letsencrypt.org"],
    [0, "issuewild", "sectigo.com"],
  ];
  const [blocked, reason] = wildcardCaaBlocked(records, "letsencrypt.org");
  assert.equal(blocked, true);
  assert.match(reason, /sectigo\.com/);
});
