/**
 * Text fingerprints — the one-way key the Cursed Scroll treasure tables are
 * recognised by, so no book wording has to ship.  Every fingerprint committed
 * to the repo was produced by this exact function: pinning a known vector is
 * what stops a "harmless" tweak to it from silently orphaning all of them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { bookItemName, cleanBookText, textFingerprint } from "../scripts/shared/text-fingerprint.mjs";

test("the fingerprint algorithm is pinned by an invented vector", () => {
  assert.equal(textFingerprint("A tin whistle on a frayed ribbon"), "1fd60541c62b9c");
  assert.equal(textFingerprint("tin whistle"), "1819164c7cb0ab");
});

test("a fingerprint is 14 hex digits and differs for different text", () => {
  const a = textFingerprint("a pewter teapot");
  const b = textFingerprint("a pewter teapots");
  assert.match(a, /^[0-9a-f]{14}$/);
  assert.notEqual(a, b);
});

test("case, spacing and curly quotes do not change the fingerprint; punctuation does", () => {
  const plain = textFingerprint("Baron's cottage, by the weir");
  assert.equal(textFingerprint("  BARON’S   cottage,\nby the weir "), plain);
  assert.notEqual(textFingerprint("Baron's cottage by the weir"), plain);
});

test("there is no fingerprint for nothing", () => {
  for (const blank of ["", "   ", null, undefined]) assert.equal(textFingerprint(blank), "");
});

test("cleanBookText keeps the printed case; bookItemName also capitalises the first letter", () => {
  assert.equal(cleanBookText("  a  baron’s \n cottage "), "a baron's cottage");
  assert.equal(cleanBookText("TIN Whistle"), "TIN Whistle");
  assert.equal(bookItemName("a baron’s  cottage"), "A baron's cottage");
  assert.equal(bookItemName("TIN Whistle"), "TIN Whistle");
  assert.equal(bookItemName(""), "");
});
