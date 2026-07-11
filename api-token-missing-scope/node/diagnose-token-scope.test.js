import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseTokenScope } from "./diagnose-token-scope.js";

test("ok when everything succeeds", () => {
  assert.equal(diagnoseTokenScope(true, { success: true }, { success: true }), "ok");
});

test("token_invalid when verify fails", () => {
  assert.equal(diagnoseTokenScope(false, { success: true }, { success: true }), "token_invalid");
});

test("missing_zone_read when zone list fails", () => {
  assert.equal(diagnoseTokenScope(true, { success: false }, { success: true }), "missing_zone_read");
});

test("missing_dns_edit when dns read fails", () => {
  assert.equal(diagnoseTokenScope(true, { success: true }, { success: false }), "missing_dns_edit");
});

test("verify failure takes priority over other failures", () => {
  assert.equal(diagnoseTokenScope(false, { success: false }, { success: false }), "token_invalid");
});

test("zone read failure takes priority over dns edit", () => {
  assert.equal(diagnoseTokenScope(true, { success: false }, { success: false }), "missing_zone_read");
});

test("missing success key treated as failure", () => {
  assert.equal(diagnoseTokenScope(true, {}, { success: true }), "missing_zone_read");
});
