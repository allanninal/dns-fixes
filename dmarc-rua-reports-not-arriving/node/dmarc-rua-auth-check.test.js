import { test } from "node:test";
import assert from "node:assert/strict";
import { needsThirdPartyAuth, parseRuaDomain } from "./dmarc-rua-auth-check.js";

test("no auth needed when same domain", () => {
  assert.equal(needsThirdPartyAuth("example.com", "example.com", [], []), false);
});

test("no auth needed when rua is subdomain", () => {
  assert.equal(needsThirdPartyAuth("example.com", "mail.example.com", [], []), false);
});

test("auth needed when different domain and missing", () => {
  assert.equal(needsThirdPartyAuth("example.com", "reports.example.net", [], []), true);
});

test("no auth needed when specific record present", () => {
  const result = needsThirdPartyAuth("example.com", "reports.example.net", ["v=DMARC1"], []);
  assert.equal(result, false);
});

test("no auth needed when wildcard record present", () => {
  const result = needsThirdPartyAuth("example.com", "reports.example.net", [], ["v=DMARC1"]);
  assert.equal(result, false);
});

test("auth needed when records present but invalid", () => {
  const result = needsThirdPartyAuth("example.com", "reports.example.net", ["not a valid record"], ["also invalid"]);
  assert.equal(result, true);
});

test("parse rua domain from record", () => {
  const record = "v=DMARC1; p=quarantine; rua=mailto:agg@reports.example.net";
  assert.equal(parseRuaDomain(record), "reports.example.net");
});

test("parse rua domain with multiple addresses uses first", () => {
  const record = "v=DMARC1; rua=mailto:agg@reports.example.net,mailto:other@else.example";
  assert.equal(parseRuaDomain(record), "reports.example.net");
});

test("parse rua domain returns null without rua", () => {
  assert.equal(parseRuaDomain("v=DMARC1; p=none"), null);
});
