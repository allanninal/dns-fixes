import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseTtlProxyMismatch } from "./proxied-record-forces-ttl.js";

test("consistent proxied record returns null", () => {
  const intended = { ttl: 1, proxied: true };
  const live = { ttl: 1, proxied: true };
  assert.equal(diagnoseTtlProxyMismatch(intended, live), null);
});

test("consistent unproxied custom ttl returns null", () => {
  const intended = { ttl: 300, proxied: false };
  const live = { ttl: 300, proxied: false };
  assert.equal(diagnoseTtlProxyMismatch(intended, live), null);
});

test("invalid config ttl 300 with proxied true", () => {
  const intended = { ttl: 300, proxied: true };
  const live = { ttl: 1, proxied: true };
  const reason = diagnoseTtlProxyMismatch(intended, live);
  assert.ok(reason);
  assert.match(reason, /invalid config/);
});

test("impossible state live proxied but ttl not one", () => {
  const intended = { ttl: 1, proxied: true };
  const live = { ttl: 300, proxied: true };
  const reason = diagnoseTtlProxyMismatch(intended, live);
  assert.ok(reason);
  assert.match(reason, /impossible state/);
});

test("proxy status drifted", () => {
  const intended = { ttl: 1, proxied: true };
  const live = { ttl: 300, proxied: false };
  const reason = diagnoseTtlProxyMismatch(intended, live);
  assert.ok(reason);
  assert.match(reason, /proxy status drifted/);
});

test("real ttl drift on unproxied record", () => {
  const intended = { ttl: 600, proxied: false };
  const live = { ttl: 300, proxied: false };
  const reason = diagnoseTtlProxyMismatch(intended, live);
  assert.ok(reason);
  assert.match(reason, /real ttl drift/);
});

test("intended ttl null with proxied true is ok", () => {
  const intended = { ttl: null, proxied: true };
  const live = { ttl: 1, proxied: true };
  assert.equal(diagnoseTtlProxyMismatch(intended, live), null);
});
