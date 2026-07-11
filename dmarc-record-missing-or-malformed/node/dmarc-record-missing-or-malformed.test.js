import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDmarcRecord } from "./dmarc-record-missing-or-malformed.js";

test("missing when no records", () => {
  const result = validateDmarcRecord([]);
  assert.equal(result.status, "missing");
  assert.equal(result.tags, null);
});

test("duplicate when two records", () => {
  const records = ["v=DMARC1; p=none", "v=DMARC1; p=reject"];
  const result = validateDmarcRecord(records);
  assert.equal(result.status, "duplicate");
});

test("valid record with p=none", () => {
  const result = validateDmarcRecord(["v=DMARC1; p=none; rua=mailto:dmarc@example.com"]);
  assert.equal(result.status, "valid");
  assert.equal(result.tags.p, "none");
  assert.equal(result.tags.v, "DMARC1");
});

test("valid record with p=quarantine and pct", () => {
  const result = validateDmarcRecord([
    "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; pct=100",
  ]);
  assert.equal(result.status, "valid");
  assert.equal(result.tags.p, "quarantine");
  assert.equal(result.tags.pct, "100");
});

test("valid record with p=reject", () => {
  const result = validateDmarcRecord(["v=DMARC1; p=reject"]);
  assert.equal(result.status, "valid");
});

test("invalid when p before v", () => {
  const result = validateDmarcRecord(["p=none; v=DMARC1"]);
  assert.equal(result.status, "invalid");
  assert.match(result.reason, /start with v=DMARC1/);
});

test("invalid when p missing", () => {
  const result = validateDmarcRecord(["v=DMARC1; rua=mailto:dmarc@example.com"]);
  assert.equal(result.status, "invalid");
  assert.match(result.reason, /p=/);
});

test("invalid when p value not allowed", () => {
  const result = validateDmarcRecord(["v=DMARC1; p=maybe"]);
  assert.equal(result.status, "invalid");
});

test("invalid when tag repeated", () => {
  const result = validateDmarcRecord(["v=DMARC1; p=none; p=reject"]);
  assert.equal(result.status, "invalid");
  assert.match(result.reason, /more than once/);
});

test("invalid when not DMARC1", () => {
  const result = validateDmarcRecord(["v=spf1 include:_spf.google.com ~all"]);
  assert.equal(result.status, "invalid");
});

test("invalid when empty string", () => {
  const result = validateDmarcRecord([""]);
  assert.equal(result.status, "invalid");
});

test("invalid when tag has no value", () => {
  const result = validateDmarcRecord(["v=DMARC1; p"]);
  assert.equal(result.status, "invalid");
});

test("handles quoted TXT string", () => {
  const result = validateDmarcRecord(['"v=DMARC1; p=none"']);
  assert.equal(result.status, "valid");
});
