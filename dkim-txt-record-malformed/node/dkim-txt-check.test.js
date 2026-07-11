import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDkimTxt } from "./dkim-txt-check.js";

test("empty when no strings", () => {
  const result = validateDkimTxt([]);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "empty_key");
});

test("embedded quotes flagged", () => {
  const result = validateDkimTxt(['"v=DKIM1; k=rsa; p=AAA123"']);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "embedded_quotes");
});

test("not base64 flagged", () => {
  const result = validateDkimTxt(["v=DKIM1; k=rsa; p=not-valid-base64!!!"]);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "not_base64");
});

test("valid key decodes", () => {
  const result = validateDkimTxt(["v=DKIM1; k=rsa; p=aGVsbG93b3JsZA=="]);
  assert.equal(result.valid, true);
  assert.equal(result.reason, "ok");
  assert.equal(result.keyBytes, 10);
});

test("key split across two strings joins cleanly", () => {
  const result = validateDkimTxt(["v=DKIM1; k=rsa; p=aGVsbG8=", ""]);
  assert.equal(result.valid, true);
  assert.equal(result.keyBytes, 5);
});

test("embedded space in key flagged", () => {
  const result = validateDkimTxt(["v=DKIM1; k=rsa; p=aGVsbG8 gd29ybGQ="]);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "embedded_quotes");
});
