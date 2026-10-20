// Points of interest: the row's own creature groups, the non-repeating pool, and the
// hex's override field. encounter-draw reads Foundry's template renderer at import,
// so the globals stand in before it is imported; everything else is this test's own.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { applications: { handlebars: { renderTemplate: async () => "" } } };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };

const { rowCreatures, drawPointOfInterest, poiRemaining, poiTableFor } = await import("../scripts/encounter/encounter-draw.mjs");
const { poiFields } = await import("../scripts/hex-map/hex-explorer.mjs");

/**
 * A TableResult as the draw reads it: the text it prints, its own flags, and a
 * face. Only what `resultBody` and the point-of-interest pool touch.
 */
const row = (description, face) => ({ id: `row${face}`, description, range: [face, face], getFlag: () => undefined });

const table = (rows) => ({ uuid: "RollTable.poi", name: "Myre Swamp Points of Interest", results: { contents: rows } });

/** The world setting the pool keeps its finds in, and nothing else of Foundry's. */
function worldSettings(initial = {}) {
  const had = globalThis.game;
  const store = { ...initial };
  globalThis.game = {
    settings: { get: (_id, key) => store[key], set: async (_id, key, value) => { store[key] = value; } },
    tables: [],
    packs: [],
  };
  return { store, restore: () => { globalThis.game = had; } };
}

test("a row's dice belong to the creature they sit before, not to the row's first", () => {
  const two = row("[[/r 2d4]] @UUID[Compendium.x.Actor.a]{beastmen} close in a circle around [[/r 1d4]] @UUID[Compendium.x.Actor.b]{dwarf soldiers}", 5);
  assert.deepEqual(rowCreatures(two).map((c) => [c.label, c.countFormula]), [["beastmen", "2d4"], ["dwarf soldiers", "1d4"]]);
  // A link run separated only by spaces is one creature: "dwarf @UUID{soldiers}".
  const spaced = row("[[/r 3]] dwarf @UUID[Compendium.x.Actor.b]{soldiers}", 6);
  assert.deepEqual(rowCreatures(spaced).map((c) => [c.label, c.countFormula]), [["soldiers", "3"]]);
  // A creature the row names without dice still gives a group, uncounted.
  const bare = row("The Wandering Merchant flees a group of [[/r 2d4]] @UUID[Compendium.x.Actor.a]{beastmen}", 7);
  assert.deepEqual(rowCreatures(bare).map((c) => [c.label, c.countFormula]), [["beastmen", "2d4"]]);
});

test("a point of interest does not repeat until the list is exhausted", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`Place ${i + 1}`, i + 1));
  const world = worldSettings();
  try {
    const first = await drawPointOfInterest(table(rows));
    const second = await drawPointOfInterest(table(rows));
    assert.notEqual(first.result.id, second.result.id);
    assert.equal(first.remaining, 19);
    assert.equal(second.remaining, 18);
    assert.deepEqual(world.store.poiUsed["RollTable.poi"], [first.result.id, second.result.id]);
    assert.deepEqual(poiRemaining(table(rows)), { remaining: 18, total: 20 });
  } finally { world.restore(); }
});

test("after the twentieth find the list starts again, rather than drawing nothing", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`Place ${i + 1}`, i + 1));
  const world = worldSettings({ poiUsed: { "RollTable.poi": rows.map((r) => r.id) } });
  try {
    const drawn = await drawPointOfInterest(table(rows));
    assert.ok(drawn.restarted);
    assert.equal(drawn.remaining, 19);
    assert.equal(world.store.poiUsed["RollTable.poi"].length, 1);
  } finally { world.restore(); }
});

test("a row the table no longer has does not count as found", async () => {
  const rows = [row("Kept", 1), row("Also kept", 2)];
  const world = worldSettings({ poiUsed: { "RollTable.poi": ["row9"] } });
  try {
    assert.deepEqual(poiRemaining(table(rows)), { remaining: 2, total: 2 });
    const drawn = await drawPointOfInterest(table(rows));
    assert.ok(["row1", "row2"].includes(drawn.result.id));
  } finally { world.restore(); }
});

test("an empty table draws nothing", async () => {
  const world = worldSettings();
  try { assert.equal(await drawPointOfInterest(table([])), null); } finally { world.restore(); }
});

test("the region's list is found by the suffix its name carries", async () => {
  const world = worldSettings();
  try {
    const poi = { uuid: "RollTable.poi", name: "Myre Swamp Points of Interest" };
    globalThis.game.tables = [{ uuid: "RollTable.other", name: "Myre Swamp Rumors" }, poi];
    assert.equal(await poiTableFor("Myre Swamp"), poi);
    assert.equal(await poiTableFor(""), null);
    assert.equal(await poiTableFor("Nowhere"), null);
  } finally { world.restore(); }
});

test("the hex keeps its own table, and an empty box hands it back to the region", () => {
  assert.deepEqual(poiFields({ poiTable: "RollTable.a" }), { poiTable: "RollTable.a" });
  assert.deepEqual(poiFields({ poiTable: "  " }), { poiTable: undefined });
  // No field at all leaves the stored one alone.
  assert.deepEqual(poiFields({}), {});
  assert.equal(Object.hasOwn(poiFields({ poiTable: "" }), "poiTable"), true);
});

test("a linked item or journal with dice before it is not a creature to place", () => {
  const mixed = row("[[/r 1d4]] @UUID[Compendium.x.Item.p]{healing potions} lie by [[/r 2d6]] @UUID[Compendium.x.Actor.a]{beastmen} and @UUID[JournalEntry.j]{the merchant}", 8);
  assert.deepEqual(rowCreatures(mixed).map((c) => [c.uuid, c.countFormula]), [["Compendium.x.Actor.a", "2d6"]]);
});

test("a row weighs by the faces it covers, not by its weight on top of them", async () => {
  const wide = { ...row("Two faces", 1), range: [1, 2], weight: 2 };
  const narrow = row("One face", 3);
  const world = worldSettings();
  const random = Math.random;
  Math.random = () => 0.7; // 70% of three faces lands on the third; counting the weight again would land on the first
  try {
    assert.equal((await drawPointOfInterest(table([wide, narrow]))).result.id, narrow.id);
  } finally { Math.random = random; world.restore(); }
});
