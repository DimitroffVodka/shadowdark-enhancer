import test from "node:test";
import assert from "node:assert/strict";
import { collapse, normalizeText, dehyphenateWrappedWords, splitRawBlocks } from "../scripts/encounter/pdf-text-utils.mjs";
import { splitStatblocks, parseStatblock } from "../scripts/encounter/statblock-parser.mjs";
import { itemRecognizer } from "../scripts/encounter/item-parser.mjs";

// All fixture text below is invented (D1) — no book content.

// ── collapse() — unchanged whitespace-collapse semantics ───────────────────

test("collapse: whitespace-only variants collapse identically to the old per-file copies", () => {
  assert.equal(collapse("  a   b\n\tc  "), "a b c");
  assert.equal(collapse(null), "");
  assert.equal(collapse(undefined), "");
  assert.equal(collapse(""), "");
});

// ── normalizeText() — conservative Unicode normalization ───────────────────

test("normalizeText: explicit ligature mapping folds ff/fi/fl/ffi/ffl", () => {
  assert.equal(normalizeText("ﬁre"), "fire");       // fi ligature
  assert.equal(normalizeText("stiﬀ"), "stiff");      // ff ligature
  assert.equal(normalizeText("ﬂame"), "flame");      // fl ligature
  assert.equal(normalizeText("aﬃx"), "affix");       // ffi ligature
  assert.equal(normalizeText("baﬄe"), "baffle");     // ffl ligature
});

test("normalizeText: uses NFC (not NFKC) — fractions and superscripts are NOT decomposed/merged", () => {
  // Under NFKC, "½" → "1⁄2" and "³" → "3", which would silently merge a
  // trailing superscript footnote marker into an unrelated number
  // ("12³" → "123"). NFC leaves these single code points untouched.
  assert.equal(normalizeText("½"), "½");
  assert.equal(normalizeText("2½ cups"), "2½ cups");
  assert.equal(normalizeText("12³"), "12³");
  assert.equal(normalizeText("HP 4³"), "HP 4³");
});

test("normalizeText: Unicode minus sign (U+2212) canonicalizes to ASCII hyphen-minus", () => {
  assert.equal(normalizeText("−5"), "-5");
  assert.equal(normalizeText("S −1, D +2"), "S -1, D +2");
});

test("normalizeText: non-breaking space becomes a regular space", () => {
  assert.equal(normalizeText("AC 12"), "AC 12");
});

test("normalizeText: smart quotes canonicalize to straight ASCII quotes", () => {
  assert.equal(normalizeText("‘goblin’"), "'goblin'");
  assert.equal(normalizeText("“goblin”"), "\"goblin\"");
});

test("normalizeText: en/em dashes canonicalize to ASCII hyphen-minus", () => {
  assert.equal(normalizeText("3–12"), "3-12");  // en dash range
  assert.equal(normalizeText("HP 4 — wounded"), "HP 4 - wounded"); // em dash
});

test("normalizeText: does NOT dehyphenate across a newline by default (opt-in only, see dehyphenateWrappedWords)", () => {
  assert.equal(normalizeText("para-\nlyzed"), "para-\nlyzed");
  assert.equal(normalizeText("under-\nworld dweller"), "under-\nworld dweller");
});

test("normalizeText: preserves a legitimate same-line hyphenated word", () => {
  assert.equal(normalizeText("will-o'-wisp"), "will-o'-wisp");
  assert.equal(normalizeText("self-aware construct"), "self-aware construct");
});

test("normalizeText: preserves legitimate split compounds across a newline (no global dehyphenation)", () => {
  // These are genuinely two different things — a hyphenated compound that
  // happens to wrap at a newline vs. a mid-word PDF column-wrap — and are
  // NOT distinguishable by a lowercase-hyphen-newline-lowercase heuristic
  // alone. Since normalizeText no longer dehyphenates by default, the
  // hyphen (and the newline) survive untouched for all of these.
  assert.equal(normalizeText("Re-\nentry"), "Re-\nentry");
  assert.equal(normalizeText("Co-\nop"), "Co-\nop");
  assert.equal(normalizeText("Self-\naware"), "Self-\naware");
});

// ── dehyphenateWrappedWords() — explicit opt-in helper, not called by default ──

test("dehyphenateWrappedWords: joins a word wrapped across a newline (lowercase-hyphen-newline-lowercase)", () => {
  assert.equal(dehyphenateWrappedWords("para-\nlyzed"), "paralyzed");
  assert.equal(dehyphenateWrappedWords("under-\nworld dweller"), "underworld dweller");
});

test("dehyphenateWrappedWords: is opt-in — normalizeText never calls it", () => {
  const s = "para-\nlyzed toad";
  assert.notEqual(normalizeText(s), dehyphenateWrappedWords(s));
  assert.equal(normalizeText(s), s);
  assert.equal(dehyphenateWrappedWords(s), "paralyzed toad");
});

test("dehyphenateWrappedWords: idempotent", () => {
  const once = dehyphenateWrappedWords("para-\nlyzed under-\nworld");
  const twice = dehyphenateWrappedWords(once);
  assert.equal(once, twice);
});

test("dehyphenateWrappedWords: null/undefined input is safe", () => {
  assert.equal(dehyphenateWrappedWords(null), "");
  assert.equal(dehyphenateWrappedWords(undefined), "");
});

test("normalizeText: does not strip or collapse newlines/whitespace itself", () => {
  const s = "GOBLIN\nAC 12, HP 4\n\nlore line";
  assert.equal(normalizeText(s), s);
});

test("normalizeText: idempotent", () => {
  const s = "“GOBLIN” AC 12 3–12 para-\nlyzed ﬁre";
  const once = normalizeText(s);
  const twice = normalizeText(once);
  assert.equal(once, twice);
});

test("normalizeText: null/undefined input is safe", () => {
  assert.equal(normalizeText(null), "");
  assert.equal(normalizeText(undefined), "");
});

// ── splitRawBlocks() integration — normalization runs at the block-split boundary ──

test("splitRawBlocks: normalizes smart quotes/dashes/nbsp within each block, keeps block structure", () => {
  const raw = "Block One ‘here’\n\nBlock Two “there” 3–12";
  const blocks = splitRawBlocks(raw);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], "Block One 'here'");
  assert.equal(blocks[1], "Block Two \"there\" 3-12");
});

test("splitRawBlocks: preserves a word wrapped across a newline (no default dehyphenation) and block structure", () => {
  const raw = "para-\nlyzed toad\n\nsecond block, un-\naffected by the first";
  const blocks = splitRawBlocks(raw);
  // Still two distinct blocks. The hyphen+newline inside each block is left
  // untouched — splitRawBlocks/normalizeText no longer dehyphenate by
  // default (see dehyphenateWrappedWords for the opt-in helper).
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], "para-\nlyzed toad");
  assert.equal(blocks[1], "second block, un-\naffected by the first");
});

// ── Regression: existing parser semantics/count/order unchanged for plain ASCII input ──

const GOBLIN = [
  "GOBLIN",
  "AC 12, HP 4, ATK 1 shortsword +1 (1d6), MV near,",
  "S -1, D +2, C +0, I -1, W -1, Ch -1, AL C, LV 1",
  "A small, wicked humanoid that hates the sun.",
].join("\n");

test("regression: splitStatblocks output is unchanged for plain-ASCII input", () => {
  const { monsters, skipped } = splitStatblocks(GOBLIN);
  assert.equal(monsters.length, 1);
  assert.equal(skipped.length, 0);
  assert.match(monsters[0], /GOBLIN/);
});

test("regression: parseStatblock draft fields are unchanged for plain-ASCII input", () => {
  const { draft } = parseStatblock(GOBLIN);
  assert.equal(draft.name, "Goblin");
  assert.equal(draft.level, 1);
  assert.equal(draft.ac, 12);
  assert.equal(draft.hp.value, 4);
});

test("regression: statblock parsing is robust to smart-quote/nbsp/dash PDF artifacts without changing extracted values", () => {
  const dirty = [
    "GOBLIN",
    "AC 12, HP 4, ATK 1 shortsword +1 (1d6), MV near,",
    "S -1, D +2, C +0, I -1, W -1, Ch -1, AL C, LV 1",
    "A small, “wicked” humanoid — hates the sun.",
  ].join("\n");
  const { monsters } = splitStatblocks(dirty);
  assert.equal(monsters.length, 1);
  const { draft } = parseStatblock(monsters[0]);
  assert.equal(draft.name, "Goblin");
  assert.equal(draft.ac, 12);
  assert.equal(draft.hp.value, 4);
});

const ITEM_DUMP = [
  "Potion of Healing",
  "50 gp, 1 slot",
  "Restores 1d6 HP when consumed.",
].join("\n");

test("regression: itemRecognizer claims the same block count/order for plain-ASCII input", () => {
  const { claimed } = itemRecognizer.claim(ITEM_DUMP);
  assert.equal(claimed.length, 1);
  assert.match(claimed[0], /Potion of Healing/);
});
