import test from "node:test";
import assert from "node:assert/strict";
import { reflowBodyLines, buildHexPageHtml } from "../scripts/importer/tables/hex-parser.mjs";

// Invented fixtures (D1): prose written here, wrapped the way a column wraps it.

test("a column's wrapped lines come back as one paragraph", () => {
  assert.deepEqual(reflowBodyLines([
    "A sea-worn statue of an angelic",
    "woman stands on a sandbar",
    "that connects three islands.",
  ]), ["A sea-worn statue of an angelic woman stands on a sandbar that connects three islands."]);
});

test("a full stop mid-paragraph is not a paragraph break", () => {
  // The line that ends a sentence is usually still mid-paragraph in a column.
  const out = reflowBodyLines(["one, two, and three.", "Four is tolerated if they do", "their business elsewhere."]);
  assert.equal(out.length, 1);
});

test("a blank line is a paragraph break", () => {
  assert.deepEqual(reflowBodyLines(["first para", "still first", "", "second para"]),
    ["first para still first", "second para"]);
});

test("a word the column broke in half is put back together", () => {
  assert.deepEqual(reflowBodyLines(["a magi-", "cal bowl"]), ["a magical bowl"]);
  // a dash that is not hyphenation stays put
  assert.deepEqual(reflowBodyLines(["a bowl -", "truly"]), ["a bowl - truly"]);
});

test("a heading and a bullet keep their own line", () => {
  assert.deepEqual(reflowBodyLines(["THE VAULT", "gold sits here", "", "- one", "- two"]),
    ["THE VAULT", "gold sits here", "- one", "- two"]);
});

test("the printed page number at the foot is dropped", () => {
  assert.deepEqual(reflowBodyLines(["prose here.", "164"]), ["prose here."]);
  assert.deepEqual(reflowBodyLines(["prose here.", "pg. 167)"]), ["prose here."]);
  assert.deepEqual(reflowBodyLines(["prose here.", "(p. 12"]), ["prose here."]);
});

test("a bare number INSIDE the body is kept: it is probably a hex reference", () => {
  const out = reflowBodyLines(["see also", "1334", "for the harbor."]);
  assert.equal(out.length, 1);
  assert.match(out[0], /1334/);
});

test("nothing to reflow is not an error", () => {
  assert.deepEqual(reflowBodyLines([]), []);
  assert.deepEqual(reflowBodyLines(undefined), []);
  assert.equal(buildHexPageHtml({ bodyLines: ["164"] }, new Set()), "<p></p>");
});

test("the page HTML is one paragraph per paragraph, not per line", () => {
  const html = buildHexPageHtml({ bodyLines: ["one", "two", "", "three"] }, new Set());
  assert.equal(html, "<p>one two</p>\n<p>three</p>");
});
