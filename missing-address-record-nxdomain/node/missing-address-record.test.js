import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMissingRecord } from "./missing-address-record.js";

test("missing record nxdomain", () => {
  assert.equal(classifyMissingRecord("NXDOMAIN", 0, true), "missing_record_nxdomain");
});

test("nodata wrong type", () => {
  assert.equal(classifyMissingRecord("NOERROR", 0, true), "nodata_wrong_type");
});

test("nodata wrong type even when not expected", () => {
  assert.equal(classifyMissingRecord("NOERROR", 0, false), "nodata_wrong_type");
});

test("ok when answers present", () => {
  assert.equal(classifyMissingRecord("NOERROR", 1, true), "ok");
});

test("ok when answers present on nxdomain rcode", () => {
  assert.equal(classifyMissingRecord("NXDOMAIN", 1, true), "ok");
});

test("nxdomain not expected is unexpected", () => {
  assert.equal(classifyMissingRecord("NXDOMAIN", 0, false), "unexpected");
});
