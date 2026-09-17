import test from "node:test";
import assert from "node:assert/strict";
import { hexcrawlRecognizer, rewriteHexPlaceholders } from "../scripts/importer/tables/hex-parser.mjs";
import { planHexCommit, hexPagePayload, hexPageName, defaultCrawlTitle, mergeKeyedRows, HEX_FLAG } from "../scripts/importer/hex/hex-commit.mjs";

// All fixture text is invented (D1) — no book content.

const DUMP = [
  "0101 The Shattered Mill",
  "A ruined watermill leans over the creek. The miller fled to hex 0203.",
  "",
  "0102 Weeping Stones",
  "Three standing stones drip brackish water (see hex 0101).",
  "",
  "0203 Fen of Sighs",
  "Reeds whisper travelers' names at dusk.",
].join("\n");

function drafts() {
  return hexcrawlRecognizer.parse(hexcrawlRecognizer.claim(DUMP).claimed);
}

test("planHexCommit: fresh entry creates every keyed draft", () => {
  const plan = planHexCommit(drafts());
  assert.equal(plan.create.length, 3);
  assert.equal(plan.update.length, 0);
  assert.deepEqual(plan.collisions, []);
});

test("planHexCommit: existing pages update in place, others create", () => {
  const existing = new Map([["1,2", "pageB"]]);   // 0102 already filed
  const plan = planHexCommit(drafts(), existing);
  assert.deepEqual(plan.create.map((d) => d.hexId), ["0101", "0203"]);
  assert.deepEqual(plan.update.map((u) => [u.draft.hexId, u.pageId]), [["0102", "pageB"]]);
});

test("planHexCommit: a key seen twice files once and reports the collision; unkeyed drafts are dropped", () => {
  const ds = drafts();
  const dup = { ...ds[0] };                       // same key as 0101
  const unkeyed = { ...ds[1], key: null, hexId: "12" };
  const plan = planHexCommit([...ds, dup, unkeyed]);
  assert.equal(plan.create.length, 3);
  assert.deepEqual(plan.collisions, ["1,1"]);
});

test("hexPagePayload: number-first name, text page, module flag, placeholders for in-set references only", () => {
  const ds = drafts();
  const keys = new Set(ds.map((d) => d.key));
  const p = hexPagePayload(ds[0], keys);
  assert.equal(p.name, "0101 The Shattered Mill");
  assert.equal(p.type, "text");
  assert.equal(p.text.format, 1);
  assert.match(p.text.content, /^<p>/);
  assert.match(p.text.content, /@@HEX\[2,3\]\{0203\}@@/);   // 0203 is in the paste → placeholder
  assert.deepEqual(p.flags["shadowdark-enhancer"][HEX_FLAG], { num: "0101", key: "1,1" });
  // an out-of-set reference stays plain text
  const lone = hexPagePayload(ds[0], new Set(["1,1"]));
  assert.doesNotMatch(lone.text.content, /@@HEX/);
});

test("pass 2: placeholders become @UUID links; unknown keys degrade to the label", () => {
  const ds = drafts();
  const keys = new Set(ds.map((d) => d.key));
  const html = hexPagePayload(ds[1], keys).text.content;   // references 0101
  const out = rewriteHexPlaceholders(html, new Map([["1,1", "Compendium.w.sde-journal.JournalEntry.a.JournalEntryPage.b"]]));
  assert.match(out, /@UUID\[Compendium\.w\.sde-journal\.JournalEntry\.a\.JournalEntryPage\.b\]\{0101\}/);
  assert.doesNotMatch(out, /@@HEX/);
  const none = rewriteHexPlaceholders(html, new Map());
  assert.match(none, /see hex 0101\)/);
});

test("names: page name trims and tolerates a missing title; default crawl title follows the source folder", () => {
  assert.equal(hexPageName({ hexId: "0101", name: "" }), "0101");
  assert.equal(hexPageName({ hexId: " 0101 ", name: " Mill " }), "0101 Mill");
  assert.equal(defaultCrawlTitle("wr"), "Western Reaches Hex Key");
  assert.equal(defaultCrawlTitle(""), "Custom Hex Key");
});

test("mergeKeyedRows: incoming wins by number, line numbers drop, output sorted", () => {
  const existing = [{ num: "0203", name: "Old Fen", zone: "A", line: 9 }, { num: "0101", name: "Mill", zone: "A", line: 1 }];
  const incoming = [{ num: "203", name: "Fen of Sighs", zone: "B", line: 4 }, { num: "0304", name: "Tower", zone: "B", line: 5 }];
  const merged = mergeKeyedRows(existing, incoming);
  assert.deepEqual(merged.map((r) => [r.num, r.name, r.zone]), [["0101", "Mill", "A"], ["203", "Fen of Sighs", "B"], ["0304", "Tower", "B"]]);
  assert.ok(merged.every((r) => !("line" in r)));
});
