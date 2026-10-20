// The Encounters Met codex's pure part: an entry's identity, so a post and then a battle map of one
// encounter are one line, and a page rebuilt from its entries, newest first, with nothing unescaped.
import test from "node:test";
import assert from "node:assert/strict";
import { entryKey, newestFirst, codexHtml } from "../scripts/encounter/encounter-codex-core.mjs";

test("an entry is known by its draw's id; one from before ids by its hour and what it was", () => {
  assert.equal(entryKey({ id: "abc", at: 0 }), "abc");
  const wolves = { at: 3600 * 10 + 59, kind: "monster", name: "Wolf", count: 3 };
  assert.equal(entryKey(wolves), entryKey({ ...wolves, at: 3600 * 10 }), "the same minute is the same line");
  assert.notEqual(entryKey(wolves), entryKey({ ...wolves, count: 4 }));
  assert.equal(entryKey({ at: 60, kind: "flavor", text: "x".repeat(80) }), `1|flavor|${"x".repeat(60)}`);
});

test("a page reads newest first, escapes what it shows, and says when it is empty", () => {
  const fmt = (k) => k;
  assert.deepEqual(newestFirst([{ at: 1 }, { at: 3 }, { at: 2 }]).map((e) => e.at), [3, 2, 1]);
  assert.match(codexHtml([], fmt), /SDE\.codex\.empty/);
  const html = codexHtml([
    { at: 1, when: "Day 1", kind: "flavor", poi: true, text: "<b>ruin</b>" },
    { at: 2, when: "Day 2", kind: "monster", name: "Wolf", count: 3, img: "wolf.webp", facets: "hunting" },
  ], fmt);
  assert.ok(html.indexOf("Day 2") < html.indexOf("Day 1"), "newest first");
  assert.match(html, /3 × Wolf/);
  assert.match(html, /SDE\.codex\.poi/, "a point of interest is labelled");
  assert.ok(!html.includes("<b>ruin</b>"), "row text is escaped");
});
