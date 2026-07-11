import { test } from "node:test";
import assert from "node:assert/strict";
import { findDanglingHop } from "./dangling-cname-chain.js";

function hop(hostname, resolvedStatus, target = null, isCname = true) {
  return { hostname, isCname, target, resolvedStatus };
}

test("clean chain returns null", () => {
  const chain = [
    hop("app.example.com", "OK", "cdn-edge.vendorone.net"),
    hop("cdn-edge.vendorone.net", "OK", "lb-shared.vendortwo.io"),
    hop("lb-shared.vendortwo.io", "OK", null, false),
  ];
  assert.equal(findDanglingHop(chain), null);
});

test("flags intermediate hop, not just first", () => {
  const chain = [
    hop("app.example.com", "OK", "cdn-edge.vendorone.net"),
    hop("cdn-edge.vendorone.net", "OK", "lb-shared.vendortwo.io"),
    hop("lb-shared.vendortwo.io", "NXDOMAIN", null, false),
  ];
  const result = findDanglingHop(chain);
  assert.equal(result.hostname, "lb-shared.vendortwo.io");
});

test("flags servfail hop", () => {
  const chain = [
    hop("app.example.com", "OK", "cdn-edge.vendorone.net"),
    hop("cdn-edge.vendorone.net", "SERVFAIL", null, false),
  ];
  const result = findDanglingHop(chain);
  assert.equal(result.hostname, "cdn-edge.vendorone.net");
});

test("flags first hop too if that is where it breaks", () => {
  const chain = [hop("app.example.com", "NXDOMAIN", null, false)];
  const result = findDanglingHop(chain);
  assert.equal(result.hostname, "app.example.com");
});

test("chain too long flags possible loop", () => {
  const chain = Array.from({ length: 12 }, (_, i) =>
    hop(`hop${i}.example.com`, "OK", `hop${i + 1}.example.com`));
  const result = findDanglingHop(chain, 10);
  assert.equal(result.reason, "chain-too-long");
});

test("terminal A record after several hops is clean", () => {
  const chain = [
    hop("a.example.com", "OK", "b.example.com"),
    hop("b.example.com", "OK", "c.example.com"),
    hop("c.example.com", "OK", "d.example.com"),
    hop("d.example.com", "OK", null, false),
  ];
  assert.equal(findDanglingHop(chain), null);
});
