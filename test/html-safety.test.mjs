/**
 * HTML-safety regressions (2026-07-11 PDF-parser review, finding #1).
 * Pasted PDF text is plain text — parsers must escape it before wrapping in
 * module markup, and never trust a leading "<" as intentional HTML.
 * All fixture text is invented — no book content.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, textToHtml } from "../scripts/importer/pdf-text-utils.mjs";
import { parseItem } from "../scripts/importer/items/item-parser.mjs";
import { parseSpell } from "../scripts/importer/spells/spell-parser.mjs";
import { parseClassSection } from "../scripts/importer/char-content/class-parser.mjs";
import { hexcrawlRecognizer, buildHexPageHtml } from "../scripts/importer/tables/hex-parser.mjs";
import { cleanImportHtml } from "../scripts/shared/compendium-suite.mjs";

const XSS = "<img src=x onerror=alert(1)>";
const noRawTag = (html) => {
  assert.ok(!/<img|<script/i.test(html), `raw tag survived: ${html}`);
  assert.ok(!/onerror\s*=[^&]/i.test(html) || !/<[a-z]+[^>]*onerror/i.test(html), `handler survived: ${html}`);
};

test("escapeHtml/textToHtml escape metacharacters and never trust a leading <", () => {
  assert.equal(escapeHtml(XSS), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(textToHtml(XSS), "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  assert.equal(textToHtml("<p>hand-written</p>"), "<p>&lt;p&gt;hand-written&lt;/p&gt;</p>");
  assert.equal(textToHtml(""), "<p></p>");
});

test("item parser: rider + description payloads are escaped (review repro)", () => {
  const r = parseItem(`CURSED MIRROR\nBenefit. ${XSS}`);
  noRawTag(r.draft.description);
  assert.match(r.draft.description, /&lt;img/);
  const gear = parseItem(`Odd Rope\n${XSS}, 5 gp, 1 slot`);
  noRawTag(gear.draft.description);
});

test("spell parser: description payloads are escaped", () => {
  const r = parseSpell(`DARK MOTE\nTier 1, Wizard\nDuration: Instant\nRange: Near\n${XSS}`);
  noRawTag(r.draft.description);
  assert.match(r.draft.description, /&lt;img/);
});

test("class parser: flavor and feature HTML are escaped", () => {
  const d = parseClassSection([
    "TESTCLASS",
    `Flavor with ${XSS} embedded.`,
    "Weapons: club",
    "Armor: none",
    "Hit Points: 1d6 per level",
    `Sneaky. Feature text ${XSS} here.`,
  ].join("\n"));
  noRawTag(d.flavor);
  for (const f of d.features) noRawTag(f.description ?? "");
});

test("hex parser: page HTML escapes body lines before linkify", () => {
  const dump = [
    `0101 Mill\n${XSS} beside hex 0102.`,
    "0102 Stones\nPlain body.",
    "0203 Fen\nPlain body.",
  ].join("\n\n");
  const { claimed } = hexcrawlRecognizer.claim(dump);
  assert.equal(claimed.length, 3);
  const drafts = hexcrawlRecognizer.parse(claimed);
  const keys = new Set(drafts.map((d) => d.key));
  const html = buildHexPageHtml(drafts[0], keys);
  noRawTag(html);
  assert.match(html, /@@HEX\[1,2\]\{0102\}@@/, "cross-reference still linkifies after escaping");
});

// ── Commit-time sanitizer (2026-07-12 review #6) ─────────────────────────────
// cleanImportHtml() is the commit choke point for preview-EDITED HTML. When
// Foundry's foundry.utils.cleanHTML is unavailable (API rename / unsupported
// version) it must fail CLOSED (escape) rather than persist raw markup.
test("cleanImportHtml fails CLOSED when foundry.utils.cleanHTML is unavailable", () => {
  const saved = globalThis.foundry;
  try {
    delete globalThis.foundry;   // simulate the sanitizer being absent
    const out = cleanImportHtml(XSS);
    assert.equal(out, "&lt;img src=x onerror=alert(1)&gt;");
    noRawTag(out);
  } finally {
    if (saved === undefined) delete globalThis.foundry; else globalThis.foundry = saved;
  }
});

test("cleanImportHtml delegates to foundry.utils.cleanHTML when present", () => {
  const saved = globalThis.foundry;
  try {
    globalThis.foundry = { utils: { cleanHTML: (s) => s.replace(/\son\w+=[^\s>]+/gi, "") } };
    assert.equal(cleanImportHtml(XSS), "<img src=x>");
  } finally {
    if (saved === undefined) delete globalThis.foundry; else globalThis.foundry = saved;
  }
});
