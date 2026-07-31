import test from "node:test";
import assert from "node:assert/strict";
import { spellItemSources } from "../scripts/crawl-strip/npc-action-menu.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────
//
// Item-shaped literals matching the Shadowdark data models: a memorised Spell
// carries its own text, while a Scroll points at one spell (system.spellUuid)
// and a Wand at several (system.spells[] = {uuid, lost}).

const spell = (name, { lost = false } = {}) => ({
  type: "Spell", id: `sp-${name}`, uuid: `Actor.a.Item.sp-${name}`, name,
  system: { lost, tier: 1 },
});

const scroll = (name, spellUuid, system = {}) => ({
  type: "Scroll", id: `sc-${name}`, uuid: `Actor.a.Item.sc-${name}`, name,
  system: { spellUuid, isIdentified: true, ...system },
});

const wand = (name, spells, system = {}) => ({
  type: "Wand", id: `wa-${name}`, uuid: `Actor.a.Item.wa-${name}`, name,
  system: { spells, isIdentified: true, broken: false, ...system },
});

const sources = (...items) => spellItemSources(items).map(s => ({
  source: s.source, item: s.item.name, spellUuid: s.spellUuid,
}));

// ── memorised spells ────────────────────────────────────────────────────────

test("memorised Spell items point at themselves", () => {
  assert.deepEqual(sources(spell("Magic Missile")), [
    { source: "spell", item: "Magic Missile", spellUuid: "Actor.a.Item.sp-Magic Missile" },
  ]);
});

test("a lost spell is dropped — it is spent until the next rest", () => {
  assert.deepEqual(sources(spell("Burning Hands", { lost: true })), []);
});

// ── scrolls ─────────────────────────────────────────────────────────────────

test("a scroll contributes the spell it carries", () => {
  assert.deepEqual(sources(scroll("Scroll of Fireball", "Compendium.x.Item.fireball")), [
    { source: "scroll", item: "Scroll of Fireball", spellUuid: "Compendium.x.Item.fireball" },
  ]);
});

test("an unidentified scroll is dropped — you don't know what it casts", () => {
  assert.deepEqual(
    sources(scroll("Odd Parchment", "Compendium.x.Item.fireball", { isIdentified: false })),
    []
  );
});

test("identification is read from the raw field when the getter is absent", () => {
  const raw = {
    type: "Scroll", id: "sc-raw", uuid: "Actor.a.Item.sc-raw", name: "Sealed Scroll",
    system: { spellUuid: "Compendium.x.Item.fireball", identification: { identified: false } },
  };
  assert.deepEqual(spellItemSources([raw]), []);
});

test("a stashed scroll is dropped — it is back at camp", () => {
  assert.deepEqual(
    sources(scroll("Scroll of Light", "Compendium.x.Item.light", { stashed: true })),
    []
  );
});

test("a scroll with no linked spell is dropped", () => {
  assert.deepEqual(sources(scroll("Blank Scroll", "")), []);
});

// ── wands ───────────────────────────────────────────────────────────────────

test("a wand contributes one row per spell it holds", () => {
  assert.deepEqual(
    sources(wand("Wand of Wonder", [
      { uuid: "Compendium.x.Item.sleep", lost: false },
      { uuid: "Compendium.x.Item.charm", lost: false },
    ])),
    [
      { source: "wand", item: "Wand of Wonder", spellUuid: "Compendium.x.Item.sleep" },
      { source: "wand", item: "Wand of Wonder", spellUuid: "Compendium.x.Item.charm" },
    ]
  );
});

test("a burned-out wand spell is dropped, the rest of the wand survives", () => {
  assert.deepEqual(
    sources(wand("Wand of Wonder", [
      { uuid: "Compendium.x.Item.sleep", lost: true },
      { uuid: "Compendium.x.Item.charm", lost: false },
    ])),
    [{ source: "wand", item: "Wand of Wonder", spellUuid: "Compendium.x.Item.charm" }]
  );
});

test("a broken wand is dropped whole — the system refuses to cast from it", () => {
  assert.deepEqual(
    sources(wand("Cracked Wand", [{ uuid: "Compendium.x.Item.sleep", lost: false }], { broken: true })),
    []
  );
});

test("a wand holding nothing yields no rows", () => {
  assert.deepEqual(sources(wand("Empty Wand", [])), []);
  assert.deepEqual(sources({ type: "Wand", id: "w", uuid: "u", name: "n", system: {} }), []);
});

// ── ordering and the rest of the inventory ──────────────────────────────────

test("order follows the character sheet: spells, then wands, then scrolls", () => {
  const out = spellItemSources([
    scroll("Scroll of Fireball", "Compendium.x.Item.fireball"),
    wand("Wand of Wonder", [{ uuid: "Compendium.x.Item.sleep", lost: false }]),
    spell("Magic Missile"),
  ]);
  assert.deepEqual(out.map(s => s.source), ["spell", "wand", "scroll"]);
});

test("non-magical inventory contributes nothing", () => {
  assert.deepEqual(
    spellItemSources([
      { type: "Weapon", id: "w1", name: "Longsword", system: { equipped: true } },
      { type: "Potion", id: "p1", name: "Potion of Healing", system: {} },
      { type: "Basic", id: "b1", name: "Torch", system: {} },
    ]),
    []
  );
});

test("no items, or junk in the list, is survivable", () => {
  assert.deepEqual(spellItemSources(), []);
  assert.deepEqual(spellItemSources([]), []);
  assert.deepEqual(spellItemSources([null, undefined, {}]), []);
});
