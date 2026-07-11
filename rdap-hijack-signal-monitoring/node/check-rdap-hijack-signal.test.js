import { test } from "node:test";
import assert from "node:assert/strict";
import { diffRdapSnapshot } from "./check-rdap-hijack-signal.js";

const snapshot = (over = {}) => ({
  status: ["clientTransferProhibited", "clientUpdateProhibited"],
  nameservers: ["ns1.cf.com", "ns2.cf.com"],
  registrant_handle: "REG-1",
  registrar_handle: "REGR-1",
  last_changed: "2026-01-01T00:00:00Z",
  ...over,
});

test("no alerts when nothing changed", () => {
  assert.deepEqual(diffRdapSnapshot(snapshot(), snapshot()), []);
});

test("alerts when transfer lock lost", () => {
  const alerts = diffRdapSnapshot(snapshot(), snapshot({ status: ["clientUpdateProhibited"] }));
  assert.ok(alerts.includes("status lost clientTransferProhibited"));
});

test("alerts when nameservers change", () => {
  const alerts = diffRdapSnapshot(snapshot(), snapshot({ nameservers: ["ns1.evil.net"] }));
  assert.ok(alerts.some((a) => a.includes("nameservers changed")));
});

test("alerts when registrant handle changes", () => {
  const alerts = diffRdapSnapshot(snapshot(), snapshot({ registrant_handle: "REG-2" }));
  assert.ok(alerts.includes("registrant_handle changed"));
});

test("alerts when registrar handle changes", () => {
  const alerts = diffRdapSnapshot(snapshot(), snapshot({ registrar_handle: "REGR-2" }));
  assert.ok(alerts.includes("registrar_handle changed"));
});

test("alerts when last_changed moves", () => {
  const alerts = diffRdapSnapshot(snapshot(), snapshot({ last_changed: "2026-06-01T00:00:00Z" }));
  assert.ok(alerts.some((a) => a.includes("last_changed event moved")));
});

test("nameserver order does not trigger a false alert", () => {
  const baseline = snapshot({ nameservers: ["ns1.cf.com", "ns2.cf.com"] });
  const current = snapshot({ nameservers: ["ns2.cf.com", "ns1.cf.com"] });
  assert.deepEqual(diffRdapSnapshot(baseline, current), []);
});

test("multiple changes all reported", () => {
  const baseline = snapshot();
  const current = snapshot({ status: [], nameservers: ["ns1.evil.net"], registrant_handle: "REG-2" });
  const alerts = diffRdapSnapshot(baseline, current);
  assert.ok(alerts.length >= 3);
});
