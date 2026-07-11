import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuplicateRecord } from "./false-positive-duplicate-detection.js";

const rec = ({ name = "acme.example.com", type = "A", setIdentifier = null, content = "192.0.2.10" } = {}) =>
  ({ name, type, setIdentifier, content });

test("weighted records with different setIdentifier are not duplicates", () => {
  const existing = rec({ setIdentifier: "us-east-primary", content: "192.0.2.10" });
  const candidate = rec({ setIdentifier: "us-east-secondary", content: "192.0.2.11" });
  assert.equal(isDuplicateRecord(existing, candidate), false);
});

test("same setIdentifier is a true duplicate", () => {
  const existing = rec({ setIdentifier: "us-east-primary", content: "192.0.2.10" });
  const candidate = rec({ setIdentifier: "us-east-primary", content: "192.0.2.10" });
  assert.equal(isDuplicateRecord(existing, candidate), true);
});

test("no setIdentifier falls back to content, Cloudflare style", () => {
  const existing = rec({ setIdentifier: null, content: "192.0.2.10" });
  const candidate = rec({ setIdentifier: null, content: "192.0.2.11" });
  assert.equal(isDuplicateRecord(existing, candidate), false);
});

test("no setIdentifier same content is a true duplicate", () => {
  const existing = rec({ setIdentifier: null, content: "192.0.2.10" });
  const candidate = rec({ setIdentifier: null, content: "192.0.2.10" });
  assert.equal(isDuplicateRecord(existing, candidate), true);
});

test("different name is never a duplicate", () => {
  const existing = rec({ name: "acme.example.com" });
  const candidate = rec({ name: "other.example.com" });
  assert.equal(isDuplicateRecord(existing, candidate), false);
});

test("trailing dot and case are normalized", () => {
  const existing = rec({ name: "Acme.Example.com." });
  const candidate = rec({ name: "acme.example.com" });
  assert.equal(isDuplicateRecord(existing, candidate), true);
});
