import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDkimSelectors } from "./dkim-selector-check.js";

const EXPECTED = {
  selector1: "selector1-yourdomain-com._domainkey.yourdomain.onmicrosoft.com",
  selector2: "selector2-yourdomain-com._domainkey.yourdomain.onmicrosoft.com",
};

test("healthy when both selectors match", () => {
  const records = {
    selector1: { type: "CNAME", target: EXPECTED.selector1 },
    selector2: { type: "CNAME", target: EXPECTED.selector2 },
  };
  assert.deepEqual(checkDkimSelectors(records, EXPECTED), []);
});

test("missing selector is flagged", () => {
  const records = {
    selector1: { type: "CNAME", target: EXPECTED.selector1 },
    selector2: { type: null, target: null },
  };
  const findings = checkDkimSelectors(records, EXPECTED);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].selector, "selector2");
  assert.equal(findings[0].issue, "missing");
});

test("txt instead of cname is wrong type", () => {
  const records = {
    selector1: { type: "CNAME", target: EXPECTED.selector1 },
    selector2: { type: "TXT", target: null },
  };
  const findings = checkDkimSelectors(records, EXPECTED);
  assert.equal(findings[0].issue, "wrong_type");
  assert.equal(findings[0].found, "TXT");
});

test("wrong target is flagged as mismatch", () => {
  const records = {
    selector1: { type: "CNAME", target: EXPECTED.selector1 },
    selector2: { type: "CNAME", target: "someone-elses-tenant._domainkey.example.onmicrosoft.com" },
  };
  const findings = checkDkimSelectors(records, EXPECTED);
  assert.equal(findings[0].issue, "target_mismatch");
});

test("missing both selectors returns two findings", () => {
  const records = {
    selector1: { type: null, target: null },
    selector2: { type: null, target: null },
  };
  const findings = checkDkimSelectors(records, EXPECTED);
  assert.equal(findings.length, 2);
  assert.deepEqual(
    new Set(findings.map((f) => f.selector)),
    new Set(["selector1", "selector2"])
  );
});
