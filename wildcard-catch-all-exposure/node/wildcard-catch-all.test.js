import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWildcardScope } from "./wildcard-catch-all.js";

test("apex catch all", () => {
  assert.equal(classifyWildcardScope("*.example.com", "example.com"), "apex_catch_all");
});

test("scoped subzone", () => {
  assert.equal(classifyWildcardScope("*.tenants.example.com", "example.com"), "scoped_subzone");
});

test("not wildcard", () => {
  assert.equal(classifyWildcardScope("app.example.com", "example.com"), "not_wildcard");
});

test("deeply scoped subzone", () => {
  assert.equal(classifyWildcardScope("*.eu.tenants.example.com", "example.com"), "scoped_subzone");
});

test("bare star dot apex is apex catch all", () => {
  assert.equal(classifyWildcardScope("*.example.com", "example.com"), "apex_catch_all");
});

test("wildcard on unrelated domain treated as apex catch all", () => {
  assert.equal(classifyWildcardScope("*.other.com", "example.com"), "apex_catch_all");
});
