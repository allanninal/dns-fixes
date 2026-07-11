import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMxHealth } from "./mx-points-to-dead-host.js";

test("single healthy host is not all down", () => {
  const records = [[10, "mail1.example.com"]];
  const ips = { "mail1.example.com": ["203.0.113.10"] };
  const ports = { "mail1.example.com": "connected" };
  const result = classifyMxHealth(records, ips, ports);
  assert.equal(result["mail1.example.com"], "healthy");
  assert.equal(result.all_down, false);
});

test("refused host is unreachable", () => {
  const records = [[10, "mail1.example.com"]];
  const ips = { "mail1.example.com": ["203.0.113.10"] };
  const ports = { "mail1.example.com": "refused" };
  const result = classifyMxHealth(records, ips, ports);
  assert.equal(result["mail1.example.com"], "unreachable");
  assert.equal(result.all_down, true);
});

test("timeout host is unreachable", () => {
  const records = [[10, "mail1.example.com"]];
  const ips = { "mail1.example.com": ["203.0.113.10"] };
  const ports = { "mail1.example.com": "timeout" };
  const result = classifyMxHealth(records, ips, ports);
  assert.equal(result["mail1.example.com"], "unreachable");
});

test("no A record is dangling", () => {
  const records = [[10, "mail1.example.com"]];
  const ips = { "mail1.example.com": [] };
  const ports = { "mail1.example.com": "no_dns" };
  const result = classifyMxHealth(records, ips, ports);
  assert.equal(result["mail1.example.com"], "dangling");
  assert.equal(result.all_down, true);
});

test("one dead one healthy is not all down", () => {
  const records = [[10, "mail1.example.com"], [20, "mail2.example.com"]];
  const ips = { "mail1.example.com": [], "mail2.example.com": ["203.0.113.20"] };
  const ports = { "mail1.example.com": "no_dns", "mail2.example.com": "connected" };
  const result = classifyMxHealth(records, ips, ports);
  assert.equal(result["mail1.example.com"], "dangling");
  assert.equal(result["mail2.example.com"], "healthy");
  assert.equal(result.all_down, false);
});

test("both dead is all down", () => {
  const records = [[10, "mail1.example.com"], [20, "mail2.example.com"]];
  const ips = { "mail1.example.com": ["203.0.113.10"], "mail2.example.com": [] };
  const ports = { "mail1.example.com": "refused", "mail2.example.com": "no_dns" };
  const result = classifyMxHealth(records, ips, ports);
  assert.equal(result.all_down, true);
});

test("empty records is all down", () => {
  const result = classifyMxHealth([], {}, {});
  assert.equal(result.all_down, true);
});
