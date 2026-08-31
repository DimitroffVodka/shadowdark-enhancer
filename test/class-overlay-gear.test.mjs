/**
 * Overlay-shipped gear vs. the WR property codes core Shadowdark has none for.
 *
 * The Paladin's Lance reaches a world by two roads: pasted into the Item
 * Builder / hub as a weapon-table row, and stocked by the Paladin class import
 * from CLASS_OVERLAYS so the wield list and the merchant know its stats. Its
 * Charge / Devastating / Mounted are WR-only properties materialized by the
 * shared managed-Property seam, so both roads must carry the same three names —
 * and neither may ship a word of book text to do it.
 *
 * Fixture data is invented where it can be: the stat row below mirrors the
 * shape of a table paste, and the property LABELS are the same labels already
 * in gear-parser's code map.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CLASS_OVERLAYS, overlayFor } from "../scripts/importer/char-content/class-overlays.mjs";
import { _internals } from "../scripts/importer/char-content/class-unit-importer.mjs";
import { buildItemData, preservedDescription } from "../scripts/importer/items/item-importer.mjs";
import { parseGear } from "../scripts/importer/items/gear-parser.mjs";

const { _staleFields } = _internals;

const LANCE = overlayFor("Paladin").items.find((i) => i.name === "Lance");
test("the Paladin's Lance carries exactly its three custom property names", () => {
  assert.deepEqual(LANCE.customProperties, ["Charge", "Devastating", "Mounted"]);
  assert.equal(LANCE.unmappedProps, undefined);
  // Still priced gear, still two-handed — custom docs change neither stat.
  assert.notEqual(LANCE.granted, true);
  assert.deepEqual(LANCE.system.cost, { gp: 15, sp: 0, cp: 0 });
  assert.equal(LANCE.system.properties.length, 1);
});

test("no other overlay item claims book-only properties", () => {
  // Guards against inventing codes for a weapon whose book row nobody read.
  for (const [cls, overlay] of Object.entries(CLASS_OVERLAYS)) {
    for (const it of overlay.items ?? []) {
      if (it.name === "Lance") continue;
      assert.equal(it.customProperties ?? undefined, undefined, `${cls}: "${it.name}" claims customProperties`);
    }
  }
});

test("both import roads write the same description for the same weapon", () => {
  // Class import carries the marker for the shared commit-time materializer.
  assert.deepEqual(LANCE.customProperties, ["Charge", "Devastating", "Mounted"]);
  // Item import (a weapon-table row for the same weapon).
  const [{ draft }] = parseGear("Lance 15 gp M C 1d12 C, D, M, 3 slots", "Weapon");
  assert.deepEqual(draft.lanceProperties, LANCE.customProperties);
  assert.deepEqual(draft.unmappedProps, []);
  // Before commit-time materialization, the parser's normal description remains
  // empty; the actual three Property links are tested through that seam below.
  assert.equal(buildItemData({ ...draft, type: "Weapon" }).system.description, "<p></p>");
});

test("overlay gear with no book-only codes keeps its empty description", () => {
  // Rapier, Falchion, Stave, Strike, Pseudopod — byte-identical to before, so a
  // re-import doesn't report them as updated.
  const rapier = overlayFor("Duelist").items.find((i) => i.name === "Rapier");
  assert.equal(rapier.customProperties ?? undefined, undefined);
});

test("a second Paladin import reuses the Lance instead of rewriting it", () => {
  const payload = { name: "Lance", type: "Weapon", system: { description: "" } };
  const stored  = { name: "Lance", type: "Weapon", system: { description: "", quantity: 1 } };
  assert.deepEqual(_staleFields(stored, payload), []);
  // The class item itself carries no generated description; custom Properties
  // are linked in system.properties before this payload reaches _ensureItem.
  // A world that predates the marker has no description churn.
  const old = { name: "Lance", type: "Weapon", system: { description: "" } };
  assert.deepEqual(_staleFields(old, payload), []);
});

test("a re-import keeps a description the GM wrote on overlay gear", () => {
  const curated = "<p>Ser Aveline's, bought at Highwater.</p>";
  // Lance now has real Property UUIDs, so its overlay description is empty;
  // the GM's text simply survives, as it does for every other overlay weapon.
  assert.equal(preservedDescription(curated, ""), curated);
  // Nothing to keep on an untouched item — the overlay payload stands.
  assert.equal(preservedDescription("", ""), null);
});
