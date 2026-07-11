import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRecord } from "./orphaned-records.js";

const UNCLAIMED_FINGERPRINTS = {
  "s3-website-us-east-1.amazonaws.com": "NoSuchBucket",
  "herokuapp.com": "no-such-app",
  "github.io": "There isn't a GitHub Pages site here",
};

const rec = (name, type, content) => ({ name, type, content });

test("active when target is in live inventory", () => {
  const record = rec("app.example.com", "CNAME", "app.herokuapp.com");
  const liveInventory = new Set(["app.herokuapp.com"]);
  assert.equal(classifyRecord(record, liveInventory, UNCLAIMED_FINGERPRINTS), "active");
});

test("orphaned when target matches known suffix and is not live", () => {
  const record = rec("old-app.example.com", "CNAME", "old-app.herokuapp.com");
  const liveInventory = new Set(["app-v2.herokuapp.com"]);
  assert.equal(classifyRecord(record, liveInventory, UNCLAIMED_FINGERPRINTS), "orphaned");
});

test("needs manual review for unknown target", () => {
  const record = rec("mystery.example.com", "CNAME", "mystery.internal-tool.com");
  const liveInventory = new Set();
  assert.equal(classifyRecord(record, liveInventory, UNCLAIMED_FINGERPRINTS), "needs_manual_review");
});

test("trailing dot and case are normalized", () => {
  const record = rec("app.example.com", "CNAME", "App.Herokuapp.com.");
  const liveInventory = new Set(["app.herokuapp.com"]);
  assert.equal(classifyRecord(record, liveInventory, UNCLAIMED_FINGERPRINTS), "active");
});

test("s3 bucket orphaned when not in inventory", () => {
  const record = rec("assets.example.com", "CNAME", "old-bucket.s3-website-us-east-1.amazonaws.com");
  const liveInventory = new Set(["new-bucket.s3-website-us-east-1.amazonaws.com"]);
  assert.equal(classifyRecord(record, liveInventory, UNCLAIMED_FINGERPRINTS), "orphaned");
});
