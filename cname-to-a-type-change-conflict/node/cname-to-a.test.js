import { test } from "node:test";
import assert from "node:assert/strict";
import { planRrsetChange } from "./cname-to-a.js";

const desired = (over = {}) => ({
  name: "app.example.com",
  type: "A",
  content: "203.0.113.10",
  ttl: 300,
  ...over,
});

test("noop when already matching", () => {
  const live = [{ id: "rec_1", type: "A", content: "203.0.113.10" }];
  assert.deepEqual(planRrsetChange(live, desired()), { action: "noop" });
});

test("overwrite when one conflicting cname", () => {
  const live = [{ id: "rec_9", type: "CNAME", content: "old-target.example.net" }];
  assert.deepEqual(planRrsetChange(live, desired()), { action: "overwrite", recordId: "rec_9" });
});

test("create when nothing exists", () => {
  assert.deepEqual(planRrsetChange([], desired()), { action: "create" });
});

test("noop when multiple conflicting records", () => {
  const live = [
    { id: "rec_1", type: "TXT", content: "v=spf1 -all" },
    { id: "rec_2", type: "MX", content: "mail.example.com" },
  ];
  assert.equal(planRrsetChange(live, desired()).action, "noop");
});

test("overwrite ignores content of conflicting type", () => {
  const live = [{ id: "rec_5", type: "CNAME", content: "anything.example.net" }];
  const plan = planRrsetChange(live, desired({ content: "198.51.100.20" }));
  assert.deepEqual(plan, { action: "overwrite", recordId: "rec_5" });
});

test("empty live records returns create", () => {
  assert.deepEqual(planRrsetChange([], desired({ type: "A", content: "203.0.113.10" })), { action: "create" });
});
