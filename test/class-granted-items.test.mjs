/**
 * Class grants vs. class gear.
 *
 * A class overlay ships two kinds of item and they are not interchangeable:
 *
 *   natural weapons — the Wyrdling's Pseudopod, the Monk's Strike. Part of the
 *     character. Every member of the class has one from creation.
 *   priced book gear — the Duelist's Rapier and Falchion, the Paladin's Lance,
 *     the Necromancer's Stave. Stocked only so the class's wield list and the
 *     merchant know the stats. The player buys these like anything else.
 *
 * Both used to land on the class as `grantedItems`, which the char-builder
 * embeds on every new character — so every Duelist rolled up holding a free
 * 8 gp Rapier and a 12 gp Falchion (the reported bug). The overlay now marks
 * grants explicitly and only those are stamped.
 *
 * These cover the pure keep-list helper and the overlay data itself; the
 * Foundry-bound sweep (pruneBoughtGearGrants) is live-verified via the bridge.
 * Fixture data is invented — "Rapier"/"Pseudopod" are item names, not prose.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { _internals } from "../scripts/importer/char-content/class-unit-importer.mjs";
import { CLASS_OVERLAYS, overlayFor } from "../scripts/importer/char-content/class-overlays.mjs";

const { keptGrantUuids } = _internals;

const GEAR    = { name: "Rapier", granted: undefined };
const NATURAL = { name: "Tendril", granted: true };

test("priced overlay gear is dropped from a grant list", () => {
  const overlay = { items: [GEAR] };
  assert.deepEqual(keptGrantUuids([{ uuid: "Item.aaa", name: "Rapier" }], overlay), []);
});

test("a natural weapon stays granted", () => {
  const overlay = { items: [NATURAL] };
  assert.deepEqual(keptGrantUuids([{ uuid: "Item.bbb", name: "Tendril" }], overlay), ["Item.bbb"]);
});

test("a mixed list keeps the natural weapon and drops the gear", () => {
  const overlay = { items: [GEAR, NATURAL] };
  const kept = keptGrantUuids(
    [{ uuid: "Item.aaa", name: "Rapier" }, { uuid: "Item.bbb", name: "Tendril" }], overlay);
  assert.deepEqual(kept, ["Item.bbb"]);
});

test("an item the overlay never mentions is left alone", () => {
  // A GM's own addition to the grant list isn't ours to remove.
  const overlay = { items: [GEAR] };
  const kept = keptGrantUuids([{ uuid: "Item.ccc", name: "Handmade Charm" }], overlay);
  assert.deepEqual(kept, ["Item.ccc"]);
});

test("an overlay with no gear at all changes nothing", () => {
  for (const overlay of [null, {}, { items: [] }, { items: [NATURAL] }]) {
    assert.deepEqual(keptGrantUuids([{ uuid: "Item.ddd", name: "Anything" }], overlay), ["Item.ddd"]);
  }
});

test("matching ignores case, and a nameless entry is not matched by accident", () => {
  const overlay = { items: [GEAR] };
  assert.deepEqual(keptGrantUuids([{ uuid: "Item.aaa", name: "RAPIER" }], overlay), []);
  // An unresolvable uuid (deleted item) reads as "" — that must not match gear.
  assert.deepEqual(keptGrantUuids([{ uuid: "Item.gone", name: "" }], overlay), ["Item.gone"]);
});

test("the sweep is idempotent — a cleaned list survives a second pass", () => {
  const overlay = { items: [GEAR, NATURAL] };
  const once = keptGrantUuids(
    [{ uuid: "Item.aaa", name: "Rapier" }, { uuid: "Item.bbb", name: "Tendril" }], overlay);
  const twice = keptGrantUuids(once.map((uuid) => ({ uuid, name: "Tendril" })), overlay);
  assert.deepEqual(twice, once);
});

// ─── The overlay data itself ────────────────────────────────────────────────

test("every overlay item that costs money is NOT a grant", () => {
  // The rule in data form: if a player can buy it, the class doesn't hand it
  // out. Guards against a future priced weapon being added with _natural.
  for (const [cls, overlay] of Object.entries(CLASS_OVERLAYS)) {
    for (const it of overlay.items ?? []) {
      const c = it.system?.cost ?? {};
      const priced = (c.gp || 0) + (c.sp || 0) + (c.cp || 0) > 0;
      if (priced) assert.notEqual(it.granted, true, `${cls}: priced "${it.name}" is marked granted`);
    }
  }
});

test("the Duelist's swords are stocked but not granted", () => {
  const duelist = overlayFor("Duelist");
  const names = duelist.items.map((i) => i.name);
  assert.deepEqual(names, ["Rapier", "Falchion"], "both WR swords still ship");
  assert.equal(duelist.items.every((i) => i.granted !== true), true);
  // Still wieldable — the reason they exist at all.
  assert.ok(duelist.weaponNames.includes("Rapier") && duelist.weaponNames.includes("Falchion"));
});

test("the natural weapons are still granted", () => {
  for (const [cls, weapon] of [["Wyrdling", "Pseudopod"], ["Monk of Yag-Kesh", "Strike"]]) {
    const it = overlayFor(cls).items.find((i) => i.name === weapon);
    assert.equal(it?.granted, true, `${cls} should grant its ${weapon}`);
  }
});
