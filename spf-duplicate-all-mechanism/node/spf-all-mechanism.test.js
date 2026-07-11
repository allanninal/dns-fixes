import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSpfAllMechanism, rebuildSpfRecord } from "./spf-all-mechanism.js";

test("ok when single all last", () => {
  const record = "v=spf1 include:_spf.google.com include:sendgrid.net -all";
  const result = checkSpfAllMechanism(record);
  assert.equal(result.ok, true);
  assert.equal(result.allCount, 1);
  assert.equal(result.allPositionOk, true);
  assert.equal(result.issue, null);
  assert.deepEqual(result.unreachableTokens, []);
});

test("duplicate all flagged", () => {
  const record = "v=spf1 include:_spf.google.com ~all include:sendgrid.net -all";
  const result = checkSpfAllMechanism(record);
  assert.equal(result.ok, false);
  assert.equal(result.allCount, 2);
  assert.equal(result.issue, "duplicate_all");
  assert.deepEqual(result.unreachableTokens, ["include:sendgrid.net", "-all"]);
});

test("all not last flagged", () => {
  const record = "v=spf1 all include:_spf.google.com -all";
  const result = checkSpfAllMechanism(record);
  assert.equal(result.ok, false);
  assert.equal(result.allCount, 2);
  assert.equal(result.allPositionOk, false);
  assert.equal(result.issue, "duplicate_all");
});

test("two all tokens anywhere", () => {
  const record = "v=spf1 a mx -all ~all";
  const result = checkSpfAllMechanism(record);
  assert.equal(result.allCount, 2);
  assert.equal(result.issue, "duplicate_all");
});

test("no all token flagged", () => {
  const record = "v=spf1 include:_spf.google.com";
  const result = checkSpfAllMechanism(record);
  assert.equal(result.ok, false);
  assert.equal(result.allCount, 0);
  assert.equal(result.issue, "all_not_last");
});

test("conflicting qualifiers, plus all first is dangerous", () => {
  const record = "v=spf1 include:_spf.google.com +all -all";
  const result = checkSpfAllMechanism(record);
  assert.equal(result.allCount, 2);
  assert.equal(result.issue, "duplicate_all");
  assert.deepEqual(result.unreachableTokens, ["-all"]);
});

test("rebuildSpfRecord moves all to end", () => {
  const record = "v=spf1 include:_spf.google.com ~all include:sendgrid.net -all";
  const corrected = rebuildSpfRecord(record, "-");
  assert.equal(corrected, "v=spf1 include:_spf.google.com include:sendgrid.net -all");
  assert.equal(checkSpfAllMechanism(corrected).ok, true);
});

test("rebuildSpfRecord handles missing version prefix", () => {
  const record = "include:_spf.google.com -all";
  const corrected = rebuildSpfRecord(record, "~");
  assert.equal(corrected, "v=spf1 include:_spf.google.com ~all");
});
