import { test } from "node:test";
import assert from "node:assert/strict";
import { findLeftoverMx } from "./leftover-mx-records-after-migration.js";

test("no leftovers when all records match", () => {
  const liveMx = [[1, "smtp.google.com."]];
  assert.deepEqual(findLeftoverMx(liveMx, ["google.com."]), []);
});

test("flags old provider records", () => {
  const liveMx = [
    [1, "smtp.google.com."],
    [10, "mx1.oldprovider.net."],
    [20, "mx2.oldprovider.net."],
  ];
  const leftovers = findLeftoverMx(liveMx, ["google.com."]);
  assert.deepEqual(leftovers, [
    [10, "mx1.oldprovider.net."],
    [20, "mx2.oldprovider.net."],
  ]);
});

test("matches are case insensitive and dot normalized", () => {
  const liveMx = [[1, "SMTP.GOOGLE.COM"]];
  assert.deepEqual(findLeftoverMx(liveMx, ["google.com."]), []);
});

test("legacy google hosts all match suffix", () => {
  const liveMx = [
    [1, "ASPMX.L.GOOGLE.COM."],
    [5, "ALT1.ASPMX.L.GOOGLE.COM."],
    [10, "ALT3.ASPMX.L.GOOGLE.COM."],
  ];
  assert.deepEqual(findLeftoverMx(liveMx, ["google.com."]), []);
});

test("microsoft 365 suffix flags unrelated host", () => {
  const liveMx = [
    [0, "example-com.mail.protection.outlook.com."],
    [10, "mx1.oldprovider.net."],
  ];
  const leftovers = findLeftoverMx(liveMx, ["mail.protection.outlook.com."]);
  assert.deepEqual(leftovers, [[10, "mx1.oldprovider.net."]]);
});

test("empty live mx returns empty list", () => {
  assert.deepEqual(findLeftoverMx([], ["google.com."]), []);
});
