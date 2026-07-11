import { test } from "node:test";
import assert from "node:assert/strict";
import { dsMatchesKsk } from "./ds-ksk-mismatch.js";

const ds = (over = {}) => ({ keyTag: 5511, algorithm: 13, digestType: 2, digest: "f1e184c0", ...over });

test("matches when ds equals live ksk digest", () => {
  assert.equal(dsMatchesKsk(ds(), ds()), true);
});

test("mismatch when key tag differs", () => {
  const oldDs = ds({ keyTag: 4310, digest: "9c2e71a5" });
  assert.equal(dsMatchesKsk(oldDs, ds()), false);
});

test("mismatch when digest differs same key tag", () => {
  const wrongDigest = ds({ digest: "deadbeef" });
  assert.equal(dsMatchesKsk(wrongDigest, ds()), false);
});

test("case insensitive digest comparison", () => {
  const upper = ds({ digest: "F1E184C0" });
  assert.equal(dsMatchesKsk(upper, ds()), true);
});

test("false when published ds missing", () => {
  assert.equal(dsMatchesKsk(null, ds()), false);
});

test("false when no live ksk found", () => {
  assert.equal(dsMatchesKsk(ds(), null), false);
});
