import test from "node:test";
import assert from "node:assert/strict";
import { reflowBodyLines, buildHexPageHtml, reflowLegacyHexHtml } from "../scripts/importer/tables/hex-parser.mjs";

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

test("a page filed one paragraph per printed line is reflowed in place", () => {
  const old = [
    "<p>A salt &amp; pepper tower leans</p>",
    "<p>over the harbor (@UUID[Compendium.world.x.JournalEntry.a.JournalEntryPage.b]{1204}), and its</p>",
    "<p>keeper is a gnome who sells magi-</p>",
    "<p>cal maps.</p>",
    "<p>pg. 12)</p>",
  ].join("\n");
  const next = reflowLegacyHexHtml(old);
  assert.equal(next, "<p>A salt &amp; pepper tower leans over the harbor "
    + "(@UUID[Compendium.world.x.JournalEntry.a.JournalEntryPage.b]{1204}), and its keeper is a gnome who sells magical maps.</p>");
  assert.equal(reflowLegacyHexHtml(next), null, "a second pass changes nothing");
});

test("a page the GM formatted, or one already a paragraph, is left alone", () => {
  assert.equal(reflowLegacyHexHtml("<p>one line</p>\n<p><strong>two</strong></p>"), null);
  assert.equal(reflowLegacyHexHtml("<p>Already one paragraph.</p>"), null);
  assert.equal(reflowLegacyHexHtml("<h2>HEAD</h2><p>a</p><p>b</p>"), null);
  assert.equal(reflowLegacyHexHtml(""), null);
});
