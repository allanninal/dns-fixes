import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDkimSelector } from "./dkim-selector-check.js";

test("missing when no answers", () => {
  const result = evaluateDkimSelector([], "google");
  assert.equal(result.status, "missing");
});

test("stale when not dkim1", () => {
  const result = evaluateDkimSelector(["v=spf1 include:_spf.example.com ~all"], "google");
  assert.equal(result.status, "stale");
});

test("stale when pubkey does not match", () => {
  const result = evaluateDkimSelector(["v=DKIM1; k=rsa; p=AAA123"], "google", "ZZZ999");
  assert.equal(result.status, "stale");
});

test("ok when record matches", () => {
  const result = evaluateDkimSelector(["v=DKIM1; k=rsa; p=AAA123"], "google", "AAA123");
  assert.equal(result.status, "ok");
});

test("ok when no pubkey fragment required", () => {
  const result = evaluateDkimSelector(["v=DKIM1; k=rsa; p=AAA123"], "google");
  assert.equal(result.status, "ok");
});
