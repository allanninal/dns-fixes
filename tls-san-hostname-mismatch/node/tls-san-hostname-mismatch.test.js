import { test } from "node:test";
import assert from "node:assert/strict";
import { sanCoversHostname } from "./tls-san-hostname-mismatch.js";

test("exact match", () => {
  assert.equal(sanCoversHostname("example.com", ["example.com", "www.example.com"]), true);
});

test("case insensitive exact match", () => {
  assert.equal(sanCoversHostname("APP.example.com", ["app.example.com"]), true);
});

test("missing hostname returns false", () => {
  assert.equal(sanCoversHostname("app.example.com", ["example.com", "www.example.com"]), false);
});

test("wildcard matches one label subdomain", () => {
  assert.equal(sanCoversHostname("app.example.com", ["*.example.com"]), true);
});

test("wildcard does not match two label subdomain", () => {
  assert.equal(sanCoversHostname("a.b.example.com", ["*.example.com"]), false);
});

test("wildcard does not match bare apex", () => {
  assert.equal(sanCoversHostname("example.com", ["*.example.com"]), false);
});

test("trailing dot and whitespace are normalized", () => {
  assert.equal(sanCoversHostname(" example.com. ", ["example.com"]), true);
});
