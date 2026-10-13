import test from "node:test";
import assert from "node:assert/strict";
import { pinNumber, EXTRAS_PIN_FLAG } from "../scripts/hex-map/extras-records.mjs";
import { HexRecords, playerProjection } from "../scripts/hex-map/hex-records.mjs";

globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b, DialogV2: {} } }, utils: { randomID: () => "id", escapeHTML: (s) => String(s) } };
globalThis._replace = (v) => v;
const { Quests } = await import("../scripts/quests/quests.mjs");

const ENH = "shadowdark-enhancer", SDX = "shadowdark-extras";
const enhancerPin = (num, extra = {}) => ({ flags: { [ENH]: { hexPin: { num } } }, ...extra });
// What Extras' hexcrawl builder places on a keyed hex (HexcrawlBuilderSD placeJournalNotes).
const extrasNote = (num, extra = {}) => ({ flags: { [SDX]: { [EXTRAS_PIN_FLAG]: { num } } }, ...extra });

test("a pin's hex number comes from the Enhancer's flag or the one Extras' builder writes", () => {
  assert.equal(pinNumber(enhancerPin(1403)), 1403);
  assert.equal(pinNumber(extrasNote(216)), 216);
  assert.equal(pinNumber({ flags: { [ENH]: { hexPin: { num: 7 } }, [SDX]: { hexJournal: { num: 8 } } } }), 7, "the Enhancer's own pin wins");
});

test("a note with no pin flag, or a number that is not one, pins nothing", () => {
  for (const note of [null, undefined, {}, { flags: {} }, { flags: { [SDX]: {} } }, extrasNote("216"), extrasNote(2.5), extrasNote(null), { flags: { other: { hexJournal: { num: 5 } } } }]) {
    assert.equal(pinNumber(note), null);
  }
});

test("reading never asks getFlag, which throws for an inactive module", () => {
  const note = { ...extrasNote(216), getFlag: () => { throw new Error('Flag scope "shadowdark-extras" is not valid or not currently active'); } };
  assert.equal(pinNumber(note), 216);
});

const page = (id) => ({ uuid: `JournalEntry.book.JournalEntryPage.${id}`, name: `${id} Page`, testUserPermission: () => true });

/** The keyed pages a player's read of hex `num` carries, on a scene holding `notes` (the path the existing records test drives). */
function keyedFor(notes, pages, num) {
  const entry = { pages: { get: (id) => pages.find((p) => p.uuid.endsWith(`.${id}`)) ?? null }, testUserPermission: () => true };
  const offset = { i: -2, j: 3 };
  const cells = { "-2_3": playerProjection({ sceneUuid: "Scene.a", offset, num, discovery: { revealed: true, visited: true } }) };
  const projection = { flags: { [ENH]: { hexRecordProjection: { sceneUuid: "Scene.a", cells } } } };
  const old = globalThis.game;
  globalThis.game = { user: { isGM: false }, journal: { contents: [projection], get: (id) => (id === "book" ? entry : null) } };
  try { return HexRecords.read(offset, { id: "a", uuid: "Scene.a", notes: { contents: notes } }).keyed ?? []; }
  finally { if (old === undefined) delete globalThis.game; else globalThis.game = old; }
}

test("the keyed pages of a hex include the page an Extras note opens, and only for its own hex", () => {
  const p = page("haldrin");
  const notes = [extrasNote(101, { entryId: "book", pageId: "haldrin" }), extrasNote(102, { entryId: "book", pageId: "other" })];
  assert.deepEqual(keyedFor(notes, [p, page("other")], 101), [{ uuid: p.uuid, title: "haldrin Page" }]);
  assert.deepEqual(keyedFor(notes, [p, page("other")], 103), []);
});

test("an Enhancer pin and an Extras note on one page give one link, not two", () => {
  const notes = [enhancerPin(101, { entryId: "book", pageId: "haldrin" }), extrasNote(101, { entryId: "book", pageId: "haldrin" })];
  assert.equal(keyedFor(notes, [page("haldrin")], 101).length, 1);
});

test("two different pages on one hex are both kept", () => {
  const notes = [enhancerPin(101, { entryId: "book", pageId: "a" }), extrasNote(101, { entryId: "book", pageId: "b" })];
  assert.deepEqual(keyedFor(notes, [page("a"), page("b")], 101).map((k) => k.title), ["a Page", "b Page"]);
});

test("a quest's Jump to pin finds the note Extras placed for its hex", () => {
  const old = globalThis.game;
  try {
    const scene = { id: "s", uuid: "Scene.s", notes: { contents: [extrasNote(216, { id: "n1", entryId: "book", pageId: "p" })] } };
    globalThis.game = { scenes: { contents: [scene] } };
    assert.equal(Quests.hasPin({ id: null, hex: 216, hexScene: null }), true);
    assert.equal(Quests.hasPin({ id: null, hex: 217, hexScene: null }), false);
    assert.equal(Quests.hasPin({ id: null, hex: 216, hexScene: "Scene.elsewhere" }), false, "a quest tied to another scene's hex does not match here");
  } finally { if (old === undefined) delete globalThis.game; else globalThis.game = old; }
});
