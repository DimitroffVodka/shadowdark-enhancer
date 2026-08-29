/**
 * Overlay-shipped gear vs. the WR property codes core Shadowdark has none for.
 *
 * The Paladin's Lance reaches a world by two roads: pasted into the Item
 * Builder / hub as a weapon-table row, and stocked by the Paladin class import
 * from CLASS_OVERLAYS so the wield list and the merchant know its stats. Its
 * Charge / Devastating / Mounted have no Property item to point at, so both
 * roads must land the same one-line note in the description — and neither may
 * ship a word of book text to do it.
 *
 * Fixture data is invented where it can be: the stat row below mirrors the
 * shape of a table paste, and the property LABELS are the same labels already
 * in gear-parser's code map.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CLASS_OVERLAYS, overlayFor } from "../scripts/importer/char-content/class-overlays.mjs";
import { _internals } from "../scripts/importer/char-content/class-unit-importer.mjs";
import { buildItemData, withPropertyNote, preservedDescription } from "../scripts/importer/items/item-importer.mjs";
import { parseGear } from "../scripts/importer/items/gear-parser.mjs";

const { _staleFields } = _internals;

const LANCE = overlayFor("Paladin").items.find((i) => i.name === "Lance");
const NOTE  = "<p><em>Properties with no core Shadowdark equivalent: Charge, Devastating, Mounted.</em></p>";

/**
 * What the class importer writes for one overlay item (mirrors createClassUnit).
 * The "" branch is deliberate there and pinned below — see the comment beside
 * the description in createClassUnit before changing either side.
 */
const overlayDescription = (it) =>
  (it.unmappedProps?.length ? withPropertyNote("", it.unmappedProps) : "");

test("the Paladin's Lance carries its book-only properties as labels", () => {
  assert.deepEqual(LANCE.unmappedProps, ["Charge", "Devastating", "Mounted"]);
  // Still priced gear, still two-handed — the note changes nothing else.
  assert.notEqual(LANCE.granted, true);
  assert.deepEqual(LANCE.system.cost, { gp: 15, sp: 0, cp: 0 });
  assert.equal(LANCE.system.properties.length, 1);
});

test("no other overlay item claims book-only properties", () => {
  // Guards against inventing codes for a weapon whose book row nobody read.
  for (const [cls, overlay] of Object.entries(CLASS_OVERLAYS)) {
    for (const it of overlay.items ?? []) {
      if (it.name === "Lance") continue;
      assert.equal(it.unmappedProps ?? undefined, undefined, `${cls}: "${it.name}" claims unmappedProps`);
    }
  }
});

test("both import roads write the same description for the same weapon", () => {
  // Class import (overlay stat line).
  assert.equal(overlayDescription(LANCE), NOTE);
  // Item import (a weapon-table row for the same weapon).
  const [{ draft }] = parseGear("Lance 15 gp M C 1d12 C, D, M, 3 slots", "Weapon");
  assert.deepEqual(draft.unmappedProps, LANCE.unmappedProps);
  assert.equal(buildItemData({ ...draft, type: "Weapon" }).system.description, NOTE);
});

test("overlay gear with no book-only codes keeps its empty description", () => {
  // Rapier, Falchion, Stave, Strike, Pseudopod — byte-identical to before, so a
  // re-import doesn't report them as updated.
  const rapier = overlayFor("Duelist").items.find((i) => i.name === "Rapier");
  assert.equal(overlayDescription(rapier), "");
});

test("a second Paladin import reuses the Lance instead of rewriting it", () => {
  const payload = { name: "Lance", type: "Weapon", system: { description: overlayDescription(LANCE) } };
  const stored  = { name: "Lance", type: "Weapon", system: { description: NOTE, quantity: 1 } };
  assert.deepEqual(_staleFields(stored, payload), []);
  // A world that predates the note is updated once, then settles.
  const old = { name: "Lance", type: "Weapon", system: { description: "" } };
  assert.deepEqual(_staleFields(old, payload), ["system.description"]);
});

test("a re-import keeps a description the GM wrote on overlay gear", () => {
  const curated = "<p>Ser Aveline's, bought at Highwater.</p>";
  // Lance: the GM's text stands, with the property note re-stamped after it.
  assert.equal(preservedDescription(curated, overlayDescription(LANCE)), `${curated}${NOTE}`);
  // Gear that ships no note at all: the text simply survives.
  assert.equal(preservedDescription(curated, ""), curated);
  // Nothing to keep on an untouched item — the overlay payload stands.
  assert.equal(preservedDescription("", overlayDescription(LANCE)), null);
});
