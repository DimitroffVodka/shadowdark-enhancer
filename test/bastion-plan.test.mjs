// The bastion plan: every view of every type draws, every piece of art it asks for exists in the sprite
// sheet, each upgrade appears once in its place, and the free rooms show the capacity left.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderPlan, interiorSlotCount, exteriorSlots } from "../scripts/bastion/bastion-plan.mjs";
import { BASTION_TYPES, BASTION_UPGRADES, newBastion, changeType } from "../scripts/bastion/bastion-core.mjs";

const sprites = readFileSync(new URL("../assets/bastion/sprites.svg", import.meta.url), "utf8");
const symbols = new Set([...sprites.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
const patterns = new Set([...sprites.matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1]));

const label = (id) => `Label ${id}`;
const t = (key) => key;
const ups = (ids, from = 0) => {
  let slot = from;
  return ids.map((id) => ({ id, slot: id === "moat" ? -1 : slot++, weeksLeft: 0 }));
};
const draw = (type, upgrades, extra = {}) => {
  const def = BASTION_TYPES.find((x) => x.id === type);
  return renderPlan({ type, slots: def.slots, upgrades, built: true, name: "Blackhollow", view: "ext", label, t, ...extra });
};
const refs = (markup) => [...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
const urls = (markup) => [...markup.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);

test("the sprite sheet has an exterior, a shadow and a room for what the plan draws", () => {
  for (const u of BASTION_UPGRADES) {
    assert.ok(symbols.has(`b-${u.id}`), `b-${u.id}`);
    assert.ok(symbols.has(`s-${u.id}`), `s-${u.id}`);
    if (u.id !== "moat") assert.ok(symbols.has(`r-${u.id}`), `r-${u.id}`);
  }
  for (const type of BASTION_TYPES) assert.ok(symbols.has(`b-${type.id}`) && symbols.has(`s-${type.id}`), type.id);
  for (const fixed of ["hall", "yard-fire", "gate-palisade", "stairwell", "entrance-hall", "roof-deck", "great-hall", "gatehouse"]) {
    assert.ok(symbols.has(`r-${fixed}`), fixed);
  }
  assert.ok(symbols.has("tuft"));
});

test("a type's plan has room for every upgrade the type holds", () => {
  for (const type of BASTION_TYPES) {
    assert.ok(interiorSlotCount(type.id) >= type.slots, `${type.id} interior`);
    assert.ok(exteriorSlots(type.id).length >= type.slots, `${type.id} exterior`);
  }
});

test("every view of every type draws, with art and patterns that exist", () => {
  for (const type of BASTION_TYPES) {
    const ids = BASTION_UPGRADES.slice(0, type.slots).map((u) => u.id);
    for (const [view, roofs] of [["ext", false], ["in", false], ["in", true]]) {
      const { markup, viewBox } = draw(type.id, ups(ids), { view, roofs });
      assert.doesNotMatch(markup, /undefined|NaN/, `${type.id} ${view} ${roofs}`);
      assert.match(viewBox, /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
      for (const ref of refs(markup)) assert.ok(symbols.has(ref), `${type.id} ${view} asks for #${ref}`);
      for (const ref of urls(markup)) assert.ok(patterns.has(ref), `${type.id} ${view} asks for pattern ${ref}`);
    }
  }
});

test("each upgrade appears once, in the view that draws it, and the moat has no room", () => {
  const ids = ["moat", "library", "tavern", "vault", "stable"];
  for (const view of ["ext", "in"]) {
    const { markup } = draw("keep", ups(ids), { view });
    const placed = [...markup.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(placed, ["library", "stable", "tavern", "vault"], view);
  }
});

test("an upgrade keeps its room: slot 3 stays where it was drawn when others are taken down", () => {
  const all = draw("castle", [{ id: "library", slot: 0 }, { id: "tavern", slot: 3 }], { view: "in" }).markup;
  const some = draw("castle", [{ id: "tavern", slot: 3 }], { view: "in" }).markup;
  const where = (m) => /<g data-id="tavern"[^>]*><title>[^<]*<\/title><g transform="([^"]+)"/.exec(m)[1];
  assert.equal(where(all), where(some));
});

test("free rooms show the capacity left and no more", () => {
  const free = (upgrades) => (draw("keep", upgrades, { view: "in" }).markup.match(/data-free="1"/g) ?? []).length;
  assert.equal(free([]), 10);
  assert.equal(free(ups(["library", "tavern", "vault"])), 7);
  assert.equal(free(ups(BASTION_UPGRADES.slice(0, 10).map((u) => u.id))), 0);
});

test("roofs cover each room's tile with its exterior, and open-air tiles have none", () => {
  const { markup } = draw("outpost", ups(["library", "tavern"]), { view: "in", roofs: true });
  assert.equal((markup.match(/class="roof"/g) ?? []).length, 2);
  assert.match(markup, /href="#b-library"/);
  const castle = draw("castle", ups(["library"]), { view: "in", roofs: true }).markup;
  assert.match(castle, /href="#b-keep"/);   // the great hall shows a keep
  assert.match(draw("castle", [], { view: "in" }).markup, /r-gatehouse/);
});

test("an upgrade still being built is drawn faint, and so is a bastion not yet raised", () => {
  const faint = draw("keep", [{ id: "library", slot: 0, weeksLeft: 1 }], { view: "ext" }).markup;
  assert.match(faint, /<g data-id="library" opacity=".45">/);
  assert.match(draw("keep", [], { view: "ext", built: false }).markup, /href="#b-keep"[^>]*opacity=".45"/);
});

test("the keep draws three floors, and the name is escaped", () => {
  const { markup } = draw("keep", [], { view: "in", name: "<b>&Hold" });
  assert.match(markup, /SDE\.bastion\.plan\.groundFloor/);
  assert.match(markup, /SDE\.bastion\.plan\.roof/);
  assert.match(markup, /&lt;b&gt;&amp;Hold/);
  assert.doesNotMatch(markup, /<b>&Hold/);
});

test("after a type change the interior draws every kept upgrade, in the rooms it moved to", () => {
  // Nine castle rooms kept at slots 10-18 (the low ones taken down) fit a keep only once re-seated.
  const nine = ["aviary", "armorer", "barracks", "blacksmith", "brewery", "casino", "dungeon", "granary", "idol"];
  const castle = { ...newBastion("castle"), weeksLeft: 0, upgrades: nine.map((id, i) => ({ id, slot: 10 + i, weeksLeft: 0 })) };
  const keep = changeType(castle, "keep").state;
  const { markup } = draw("keep", keep.upgrades, { view: "in" });
  const placed = [...markup.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(placed, [...nine].sort());
});
