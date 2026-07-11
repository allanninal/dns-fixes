import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApexCnameConflict } from "./apex-cname-conflict.js";

test("ok when no cname and ns/soa present", () => {
  const records = { CNAME: [], NS: ["ns1.example.com"], SOA: ["soa data"], A: ["203.0.113.10"] };
  assert.equal(classifyApexCnameConflict(records), "ok");
});

test("conflict when cname present and ns/soa missing", () => {
  const records = { CNAME: ["target.example.net"], NS: [], SOA: [], A: [] };
  assert.equal(classifyApexCnameConflict(records), "conflict_literal_cname");
});

test("flattened ok when cname upstream but a and ns/soa intact", () => {
  const records = {
    CNAME: ["target.example.net"],
    NS: ["ns1.example.com"],
    SOA: ["soa data"],
    A: ["203.0.113.10"],
  };
  assert.equal(classifyApexCnameConflict(records), "flattened_ok");
});

test("conflict when cname present and no a or aaaa", () => {
  const records = { CNAME: ["target.example.net"], NS: ["ns1.example.com"], SOA: ["soa data"], A: [] };
  assert.equal(classifyApexCnameConflict(records), "conflict_literal_cname");
});

test("conflict when no cname but missing ns", () => {
  const records = { CNAME: [], NS: [], SOA: ["soa data"], A: ["203.0.113.10"] };
  assert.equal(classifyApexCnameConflict(records), "conflict_literal_cname");
});

test("flattened ok with only aaaa", () => {
  const records = {
    CNAME: ["target.example.net"],
    NS: ["ns1.example.com"],
    SOA: ["soa data"],
    A: [],
    AAAA: ["2001:db8::10"],
  };
  assert.equal(classifyApexCnameConflict(records), "flattened_ok");
});
