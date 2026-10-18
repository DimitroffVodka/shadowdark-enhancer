import test from "node:test";
import assert from "node:assert/strict";
import { ZONES, canMoveZone, cloneActorData, cloneNames, foeZoneFor, hpBand, isZoneFight, layoutBands, normalizeZone, stepZone, zoneFightOf } from "../scripts/stage/zone-core.mjs";

const M = "shadowdark-enhancer";

test("normalizeZone keeps the three bands, everything else is close", () => {
  assert.deepEqual(ZONES, ["close", "near", "far"]);
  for (const z of ZONES) assert.equal(normalizeZone(z), z);
  for (const j of [undefined, null, "", "FAR", 2, {}]) assert.equal(normalizeZone(j), "close");
});

test("stepZone moves one band and clamps at the ends", () => {
  assert.equal(stepZone("close", "farther"), "near");
  assert.equal(stepZone("near", "farther"), "far");
  assert.equal(stepZone("far", "farther"), "far");
  assert.equal(stepZone("far", "closer"), "near");
  assert.equal(stepZone("close", "closer"), "close");
  assert.equal(stepZone("near", "sideways"), "near");
  assert.equal(stepZone("junk", "farther"), "near");
  assert.equal(stepZone(undefined, "nope"), "close");
});

test("foeZoneFor follows the distance die", () => {
  assert.equal(foeZoneFor(1), "close");
  for (const r of [2, 3, 4]) assert.equal(foeZoneFor(r), "near");
  for (const r of [5, 6]) assert.equal(foeZoneFor(r), "far");
  for (const j of [undefined, null, "x", 0, 9]) assert.equal(foeZoneFor(j), "near");
});

test("cloneNames numbers from 1, skips taken names, stays unique", () => {
  assert.deepEqual(cloneNames("Goblin", 3, []), ["Goblin 1", "Goblin 2", "Goblin 3"]);
  assert.deepEqual(cloneNames("Goblin", 2, new Set(["Goblin 1", "Goblin 3"])), ["Goblin 2", "Goblin 4"]);
  assert.deepEqual(cloneNames("Goblin", 2, ["Goblin 1"]), ["Goblin 2", "Goblin 3"]);
  assert.deepEqual(cloneNames("Goblin", 2, ["Goblin 1"]), cloneNames("Goblin", 2, ["Goblin 1"]));
  for (const c of [0, -1, NaN, undefined, "x"]) assert.deepEqual(cloneNames("G", c, []), []);
  assert.deepEqual(cloneNames("  ", 1, null), ["Foe 1"]);
  assert.deepEqual(cloneNames(null, 1, undefined, "Orc"), ["Orc 1"]);
  assert.equal(new Set(cloneNames("A", 20, ["A 5"])).size, 20);
});

test("cloneActorData builds create data and leaves the source alone", () => {
  const source = {
    _id: "abc", name: "Goblin", folder: "old", ownership: { default: 2, u1: 3 },
    _stats: { compendiumSource: "Compendium.x.y" },
    flags: { other: { a: 1 }, [M]: { zoneClone: "old", zoneFight: 1, keep: true } },
    system: { hp: 3 },
  };
  const copy = structuredClone(source);
  const out = cloneActorData(source, { name: "Goblin 1", folder: "f1", fightId: "fight" });
  assert.deepEqual(source, copy);
  assert.ok(!("_id" in out));
  assert.equal(out.name, "Goblin 1");
  assert.equal(out.folder, "f1");
  assert.deepEqual(out.ownership, { default: 0 });
  assert.equal(out._stats.compendiumSource, "Compendium.x.y");
  assert.deepEqual(out.flags[M], { keep: true, zoneClone: "fight" });
  assert.deepEqual(out.flags.other, { a: 1 });
  assert.notEqual(out.flags, source.flags);
  assert.notEqual(out.flags[M], source.flags[M]);
  assert.deepEqual(cloneActorData(null, { name: "N", fightId: "f" }).flags[M], { zoneClone: "f" });
});

test("canMoveZone: GM anyone, a player only their own non-foe", () => {
  assert.equal(canMoveZone({ isGM: true, isFoe: true }), true);
  assert.equal(canMoveZone({ ownsActor: true }), true);
  assert.equal(canMoveZone({ ownsActor: true, isFoe: true }), false);
  assert.equal(canMoveZone({ ownsActor: false }), false);
  assert.equal(canMoveZone({}), false);
  assert.equal(canMoveZone(), false);
});

test("layoutBands groups by zone in input order and survives junk", () => {
  const a = { id: "a", zone: "far" }, b = { id: "b", zone: "close" }, c = { id: "c", zone: "far" }, d = { id: "d" }, e = { id: "e", zone: "weird" }, f = { id: "f", zone: "near" };
  const out = layoutBands([a, null, b, 5, c, d, e, f]);
  assert.deepEqual(out.far.map((x) => x.id), ["a", "c"]);
  assert.deepEqual(out.close.map((x) => x.id), ["b", "d", "e"]);
  assert.deepEqual(out.near, [f]);
  for (const j of [null, undefined, "x", {}]) assert.deepEqual(layoutBands(j), { close: [], near: [], far: [] });
});

test("hpBand gives a ratio and the strip's five tones, never numbers", () => {
  assert.deepEqual(hpBand(10, 10), { ratio: 1, tone: "ok" });
  assert.equal(hpBand(8, 10).tone, "ok");
  assert.equal(hpBand(7.5, 10).tone, "mid");
  assert.equal(hpBand(6, 10).tone, "mid");
  assert.equal(hpBand(5, 10).tone, "low");
  assert.equal(hpBand(3, 10).tone, "low");
  assert.equal(hpBand(2.5, 10).tone, "critical");
  assert.equal(hpBand(1, 10).tone, "critical");
  assert.deepEqual(hpBand(0, 10), { ratio: 0, tone: "dead" });
  assert.deepEqual(hpBand(-4, 10), { ratio: 0, tone: "dead" });
  assert.equal(hpBand(20, 10).ratio, 1);
  for (const [h, m] of [[5, 0], [5, -1], [5, "x"], [NaN, 5], [undefined, 5], [null, null]]) assert.deepEqual(hpBand(h, m), { ratio: 0, tone: "dead" });
});

test("isZoneFight and zoneFightOf read one flag", () => {
  const fight = (zf) => ({ flags: { [M]: { zoneFight: zf } } });
  for (const j of [null, undefined, {}, { flags: {} }, fight(null), fight({}), fight({ id: "" }), fight({ id: 5 }), fight("x")]) {
    assert.equal(isZoneFight(j), false);
    assert.equal(zoneFightOf(j), null);
  }
  const c = fight({ id: "f1", at: 5, clones: ["a", "a", "", 3, "b"], source: "s" });
  assert.equal(isZoneFight(c), true);
  assert.deepEqual(zoneFightOf(c), { id: "f1", at: 5, clones: ["a", "b"], source: "s" });
  assert.deepEqual(zoneFightOf(fight({ id: "f2", clones: "no" })), { id: "f2", at: null, clones: [], source: null });
});
