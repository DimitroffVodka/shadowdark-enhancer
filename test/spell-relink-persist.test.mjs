/**
 * Foundry-bound spell↔class relink persistence (AI-Council correction #7).
 *
 * relinkSpellsToClasses() is the retro half of "spells and classes import in
 * either order". Its Foundry touch points (pack, ClassIndex, fromUuid,
 * Item.updateDocuments, Hooks) are injectable, so the persistence logic is
 * tested here without a live world. Covers: empty/dead refs relink, live refs
 * preserved, exact persisted system.class arrays, folder fallback, intent-flag
 * priority, both import orders, and borrowed/multi-class spells never
 * overwritten. The live semantics are unchanged — only the seams are new.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { relinkSpellsToClasses } from "../scripts/importer/items/item-importer.mjs";

const MODULE_ID = "shadowdark-enhancer";

/** Build a fake spells pack + injectable deps. */
function harness({ entries, folders = {}, classes = {}, live = [], locked = false }) {
  const liveSet = new Set(live);
  const captured = { updates: null, updateOpts: null, hooks: [], configured: false };
  const pack = {
    collection: "world.spells",
    get locked() { return locked; },
    folders: new Map(Object.entries(folders).map(([id, name]) => [id, { name }])),
    async getIndex() { return entries; },
    async configure() { captured.configured = true; locked = false; },
  };
  const deps = {
    pack,
    resolveByName: async (name) => (classes[name] ? { uuid: classes[name] } : null),
    resolveUuid: async (u) => (liveSet.has(u) ? { name: u } : null),
    updateDocuments: async (updates, opts) => { captured.updates = updates; captured.updateOpts = opts; },
    callHook: (name) => captured.hooks.push(name),
  };
  return { deps, captured };
}

const spell = (id, over = {}) => ({
  _id: id, type: "Spell",
  system: { class: over.class ?? [] },
  folder: over.folder ?? null,
  flags: over.flags ?? {},
});

test("empty class ref + intent flag → linked to the stamped class (exact array)", async () => {
  const { deps, captured } = harness({
    entries: [spell("s1", { flags: { [MODULE_ID]: { spellClassName: "Necromancer" } } })],
    classes: { Necromancer: "Compendium.x.Item.necro" },
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 1);
  assert.deepEqual(captured.updates, [{ _id: "s1", "system.class": ["Compendium.x.Item.necro"] }]);
  assert.deepEqual(captured.updateOpts, { pack: "world.spells" });
  assert.deepEqual(captured.hooks, [`${MODULE_ID}.contentUnlocked`]);
});

test("dead class ref + folder fallback (no stamp) → relinked via folder name", async () => {
  const { deps, captured } = harness({
    entries: [spell("s1", { class: ["Compendium.dead.Item.gone"], folder: "f1" })],
    folders: { f1: "Necromancer" },
    classes: { Necromancer: "Compendium.x.Item.necro" },
    live: [],   // the existing ref does not resolve → dead
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 1);
  assert.deepEqual(captured.updates, [{ _id: "s1", "system.class": ["Compendium.x.Item.necro"] }]);
});

test("live class ref is preserved — spell untouched, no write, no hook", async () => {
  const { deps, captured } = harness({
    entries: [spell("s1", { class: ["Compendium.live.Item.here"] })],
    live: ["Compendium.live.Item.here"],
    classes: { Necromancer: "Compendium.x.Item.necro" },
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 0);
  assert.equal(captured.updates, null);
  assert.deepEqual(captured.hooks, []);
});

test("intent flag beats folder fallback when they disagree", async () => {
  const { deps, captured } = harness({
    entries: [spell("s1", { folder: "f1", flags: { [MODULE_ID]: { spellClassName: "Necromancer" } } })],
    folders: { f1: "Wizard (Druid)" },
    classes: { Necromancer: "Compendium.x.Item.necro", Wizard: "Compendium.x.Item.wiz" },
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 1);
  assert.deepEqual(captured.updates[0]["system.class"], ["Compendium.x.Item.necro"]);
});

test("folder fallback strips the '(Variant)' suffix to the class name", async () => {
  const { deps, captured } = harness({
    entries: [spell("s1", { folder: "f1" })],
    folders: { f1: "Wizard (Druid)" },
    classes: { Wizard: "Compendium.x.Item.wiz" },
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 1);
  assert.deepEqual(captured.updates[0]["system.class"], ["Compendium.x.Item.wiz"]);
});

test("both import orders: spell-first (unlinked) relinks; class-first (already live) is left alone", async () => {
  const { deps, captured } = harness({
    entries: [
      spell("first", { flags: { [MODULE_ID]: { spellClassName: "Necromancer" } } }),        // imported before its class
      spell("already", { class: ["Compendium.live.Item.necro"] }),                            // imported after (linked at commit)
    ],
    live: ["Compendium.live.Item.necro"],
    classes: { Necromancer: "Compendium.new.Item.necro" },
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 1);
  assert.deepEqual(captured.updates, [{ _id: "first", "system.class": ["Compendium.new.Item.necro"] }]);
});

test("borrowed / multi-class spell with any live ref is never overwritten", async () => {
  const { deps, captured } = harness({
    // A Green Knight druid spell carrying BOTH the Wizard list (live) and GK.
    entries: [spell("s1", { class: ["Compendium.shadowdark.Item.wizard", "Compendium.world.Item.gk"] })],
    live: ["Compendium.shadowdark.Item.wizard"],
    classes: { Wizard: "Compendium.x.Item.other" },
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 0, "a spell with a live link is skipped, borrowed lists intact");
  assert.equal(captured.updates, null);
});

test("class still absent → spell left for a later import (no update)", async () => {
  const { deps, captured } = harness({
    entries: [spell("s1", { flags: { [MODULE_ID]: { spellClassName: "Warlock" } } })],
    classes: {},   // Warlock not imported yet
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 0);
  assert.equal(captured.updates, null);
});

test("non-Spell entries are ignored", async () => {
  const { deps, captured } = harness({
    entries: [{ _id: "t1", type: "Talent", system: {}, folder: "f1", flags: {} }],
    folders: { f1: "Necromancer" },
    classes: { Necromancer: "Compendium.x.Item.necro" },
  });
  const n = await relinkSpellsToClasses(deps);
  assert.equal(n, 0);
  assert.equal(captured.updates, null);
});
