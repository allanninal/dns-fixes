import { test } from "node:test";
import assert from "node:assert/strict";
import { planDnsWrite } from "./duplicate-record-write-conflict.js";

const desired = (over = {}) => ({
  name: "app.example.com", type: "A", content: "203.0.113.10",
  ttl: 300, proxied: false, ...over,
});

const existing = (over = {}) => ({
  id: "rec_1", name: "app.example.com", type: "A",
  content: "203.0.113.10", ttl: 300, proxied: false, ...over,
});

test("creates when nothing exists", () => {
  const plan = planDnsWrite([], desired());
  assert.equal(plan.action, "create");
  assert.deepEqual(plan.body, desired());
});

test("noop when existing matches desired", () => {
  const plan = planDnsWrite([existing()], desired());
  assert.deepEqual(plan, { action: "noop", id: "rec_1" });
});

test("update when content differs", () => {
  const plan = planDnsWrite([existing({ content: "203.0.113.99" })], desired());
  assert.equal(plan.action, "update");
  assert.equal(plan.id, "rec_1");
  assert.deepEqual(plan.body, { content: "203.0.113.10" });
});

test("update only sends changed fields", () => {
  const plan = planDnsWrite([existing({ ttl: 60 })], desired());
  assert.deepEqual(plan.body, { ttl: 300 });
});

test("update when proxied differs", () => {
  const plan = planDnsWrite([existing({ proxied: true })], desired());
  assert.equal(plan.action, "update");
  assert.deepEqual(plan.body, { proxied: false });
});

test("CNAME conflict modeled as existing record of a different type", () => {
  // A CNAME-vs-A conflict is modeled as an existing record at the same
  // name but a different type. planDnsWrite only inspects the first
  // existing record; the caller decides which record wins.
  const cnameExisting = [{
    id: "rec_cname", name: "app.example.com", type: "CNAME",
    content: "app.hosting-provider.net", ttl: 300, proxied: false,
  }];
  const plan = planDnsWrite(cnameExisting, desired());
  assert.equal(plan.action, "update");
  assert.equal(plan.id, "rec_cname");
});
