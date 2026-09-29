import test from "node:test";
import assert from "node:assert/strict";
import {
  hydrateState, loadActorSnapshot, summarizeHydration, PHYSICAL_TYPES,
} from "../scripts/char-builder/hydrate.mjs";

const CLASS_UUID = "Compendium.shadowdark.classes.Item.fighter";
const ANC_UUID = "Compendium.shadowdark.ancestries.Item.dwarf";

const item = (id, type, name, extra = {}) => ({
  _id: id, type, name, img: "i.webp", system: {}, flags: {}, _stats: {}, ...extra,
});
const gear = (id, type, name, qty = 1, slots = { slots_used: 1, free_carry: 0, per_slot: 1 }) =>
  item(id, type, name, { system: { quantity: qty, slots } });

/** A level-1 dwarf fighter trimmed from the real pregen shape. */
function snap(over = {}, items = []) {
  return {
    actorId: "actor1",
    sessionId: "sess1",
    name: "Dwarf Fighter 1",
    img: "icons/svg/mystery-man.svg",
    tokenImg: null,
    defaultArt: ["icons/svg/mystery-man.svg"],
    system: {
      abilities: { str: { value: 15 }, dex: { value: 10 }, con: { value: 14 }, int: { value: 8 }, wis: { value: 12 }, cha: { value: 9 } },
      level: { value: 1, xp: 3 },
      alignment: "lawful",
      ancestry: ANC_UUID,
      class: CLASS_UUID,
      background: "Compendium.shadowdark.backgrounds.Item.smith",
      deity: "",
      patron: null,
      attributes: { hp: { max: 9, value: 11 } },
      coins: { gp: 0, sp: 25, cp: 0 },
      languages: ["Compendium.shadowdark.languages.Item.common", "Compendium.shadowdark.languages.Item.dwarvish"],
      ...over,
    },
    items,
  };
}

const RESOLVED = {
  class: { uuid: CLASS_UUID, name: "Fighter", system: { spellcasting: { class: "__not_spellcaster__" } } },
  ancestry: { uuid: ANC_UUID, name: "Dwarf", system: {} },
  background: { uuid: "x", name: "Smith", system: {} },
  spellPool: [],
};

test("abilities are the stored base, not the derived value", () => {
  const s = snap({ abilities: {
    str: { value: 7 }, dex: { value: 10 }, con: { value: 10 },
    int: { value: 16 }, wis: { value: 10 }, cha: { value: 10 },
  } }, [
    item("e1", "Effect", "Damage: STR (-1)"),
    item("t1", "Talent", "Stat Bonus (+2 INT)"),
  ]);
  const st = hydrateState(s, RESOLVED);
  assert.equal(st.stats.method, "manual");
  assert.equal(st.stats.values.str, 7);
  assert.equal(st.stats.values.int, 16);
  assert.equal(st.existing.baseline.abilities.str, 7);
});

test("hp is the base max with no bonus, and hp.value is not hydrated into the state", () => {
  const st = hydrateState(snap({}, [item("t1", "Talent", "Stout")]), RESOLVED);
  assert.deepEqual(st.hp, { max: 9, bonus: 0, hydrated: true });
  assert.equal(st.existing.baseline.hp.value, 11);
  assert.equal("value" in st.hp, false);
});

test("duplicate gear stays as separate rows keyed by embedded id", () => {
  const st = hydrateState(snap({}, [
    gear("a1", "Basic", "Torch"), gear("a2", "Basic", "Torch"),
    gear("b1", "Basic", "Oil Flask"), gear("b2", "Basic", "Oil Flask"),
  ]), RESOLVED);
  assert.equal(st.gear.length, 4);
  assert.deepEqual(st.gear.map((g) => g.itemId), ["a1", "a2", "b1", "b2"]);
  assert.deepEqual(st.gear.map((g) => g.rowId), ["a1", "a2", "b1", "b2"]);
  assert.ok(st.gear.every((g) => g.owned && g.costCp === 0));
  assert.equal(new Set(st.existing.gearRows.map((g) => g.itemId)).size, 4);
});

test("non-physical, non-spell items are kept and never a gear or spell row", () => {
  const st = hydrateState(snap({}, [
    item("e1", "Effect", "Damage: STR (-1)"),
    item("t1", "Talent", "Weapon Mastery (Longsword)"),
    item("c1", "Class Ability", "Rage"),
    item("b1", "Boon", "Patron Boon"),
    gear("g1", "Weapon", "Longsword"),
  ]), RESOLVED);
  assert.deepEqual(st.existing.kept.map((k) => k.id), ["e1", "t1", "c1", "b1"]);
  assert.deepEqual(st.existing.kept.map((k) => k.type), ["Effect", "Talent", "Class Ability", "Boon"]);
  assert.deepEqual(st.gear.map((g) => g.itemId), ["g1"]);
  assert.equal(st.spells.length, 0);
});

test("Potion, Scroll, Wand and Gem are gear rows", () => {
  const st = hydrateState(snap({}, ["Potion", "Scroll", "Wand", "Gem", "Armor"].map((t, i) => gear(`p${i}`, t, `A ${t}`))), RESOLVED);
  assert.equal(st.gear.length, 5);
  assert.equal(st.existing.kept.length, 0);
  for (const t of ["Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Weapon"]) assert.ok(PHYSICAL_TYPES.has(t));
});

test("gear rows carry the item's quantity and slots", () => {
  const st = hydrateState(snap({}, [
    gear("r1", "Basic", "Rations", 3, { slots_used: 1, free_carry: 0, per_slot: 5 }),
    gear("w1", "Basic", "Whetstone", 1, { slots_used: 0, free_carry: 0, per_slot: 1 }),
  ]), RESOLVED);
  assert.equal(st.gear[0].qty, 3);
  assert.equal(st.gear[0].slots, 1);
  assert.equal(st.gear[1].slots, 0);
  assert.equal(st.trinket, "");
});

test("spell name ambiguity is settled by the class filter", () => {
  const mage = "Compendium.shadowdark.classes.Item.wizard";
  const s = snap({ class: mage }, [item("s1", "Spell", "Charm Person", { system: { tier: 1 } })]);
  const st = hydrateState(s, {
    class: { uuid: mage, name: "Wizard", system: { spellcasting: { class: "" } } },
    spellPool: [
      { uuid: "Compendium.p.Item.priestCharm", name: "Charm Person", tier: 1, class: ["Compendium.shadowdark.classes.Item.priest"] },
      { uuid: "Compendium.p.Item.wizardCharm", name: "Charm Person", tier: 1, class: [mage] },
    ],
  });
  assert.equal(st.spells[0].uuid, "Compendium.p.Item.wizardCharm");
  assert.equal(st.spells[0].itemId, "s1");
});

test("spell source link wins over name, and an unmatched spell keeps uuid null", () => {
  const s = snap({}, [
    item("s1", "Spell", "Light", { system: { tier: 1 }, _stats: { compendiumSource: "Compendium.a.Item.x" } }),
    item("s2", "Spell", "Fireball", { system: { tier: 3 }, flags: { core: { sourceId: "Compendium.shadowdark-extras.pack-sdxitems.Item.y" } } }),
    item("s3", "Spell", "Homebrew Hex", { system: { tier: 2 } }),
  ]);
  const st = hydrateState(s, RESOLVED);
  assert.deepEqual(st.spells.map((x) => x.uuid), [
    "Compendium.a.Item.x", "Compendium.shadowdark-extras.pack-sdxitems.Item.y", null,
  ]);
  assert.deepEqual(st.spells.map((x) => x.tier), [1, 3, 2]);
  assert.equal(st.existing.spellRows.length, 3);
});

test("a missing compendium keeps the uuid string and marks it unresolved", () => {
  const st = hydrateState(snap(), { spellPool: [] });
  assert.deepEqual(st.ancestry, { uuid: ANC_UUID, name: "dwarf", item: null, unresolved: true });
  assert.deepEqual(st.class, { uuid: CLASS_UUID, name: "fighter", item: null, unresolved: true });
  assert.equal(st.existing.baseline.class, CLASS_UUID);
  assert.equal(st.deity, null);
  assert.equal(st.patron, null);
});

test("a level-0 Funnel actor hydrates with level0 true and no class row", () => {
  const s = snap({ level: { value: 0, xp: 0 }, class: null, ancestry: ANC_UUID }, [gear("g1", "Basic", "Rope")]);
  const st = hydrateState(s, { ancestry: RESOLVED.ancestry });
  assert.equal(st.level0, true);
  assert.equal(st.class, null);
  assert.equal(st.existing.baseline.level, 0);
  assert.equal(st.level, 1);
  assert.equal(st.ancestry.name, "Dwarf");
});

test("a blank actor hydrates to null", () => {
  const blank = snap({ level: { value: 0, xp: 0 }, ancestry: null, class: null, background: null }, []);
  assert.equal(hydrateState(blank, {}), null);
  assert.equal(summarizeHydration(null), null);
});

test("coins are current wealth: kept as-is, baseline in copper, gold step off", () => {
  const st = hydrateState(snap(), RESOLVED);
  assert.deepEqual(st.coins, { gp: 0, sp: 25, cp: 0 });
  assert.equal(st.existing.baseline.coinsCp, 250);
  assert.equal(st.goldRolled, true);
});

test("languages are copied by uuid", () => {
  const s = snap();
  const st = hydrateState(s, RESOLVED);
  assert.deepEqual(st.languages, s.system.languages);
  assert.notEqual(st.languages, s.system.languages);
  assert.deepEqual(st.existing.baseline.languages, s.system.languages);
});

test("identity, art and baseline come from the actor", () => {
  const s = snap({}, []);
  s.img = "art/dwarf.webp";
  s.tokenImg = "icons/svg/mystery-man.svg";
  const st = hydrateState(s, RESOLVED);
  assert.equal(st.name, "Dwarf Fighter 1");
  assert.equal(st.alignment, "lawful");
  assert.deepEqual(st.art, { portrait: "art/dwarf.webp", token: null });
  assert.equal(st.existing.actorId, "actor1");
  assert.equal(st.existing.sessionId, "sess1");
  assert.equal(st.existing.frozenLevel, 1);
  assert.equal(st.existing.baseline.xp, 3);
  assert.equal(st.existing.baseline.deity, null);
});

test("summary lists what hydrates and what is kept", () => {
  const st = hydrateState(snap({}, [gear("g1", "Basic", "Torch", 2), item("t1", "Talent", "Stout")]), RESOLVED);
  const sum = summarizeHydration(st);
  assert.deepEqual(sum.gear, ["Torch x2 [Basic]"]);
  assert.deepEqual(sum.kept, ["Stout [Talent]"]);
  assert.equal(sum.class, "Fighter");
});

test("loadActorSnapshot reads only _source and toObject, never actor.system", async () => {
  const src = snap({}, [gear("g1", "Basic", "Torch"), item("s1", "Spell", "Light", { system: { tier: 1 } })]);
  const real = {
    id: "actor1", name: "Dwarf Fighter 1", img: "a.webp",
    prototypeToken: { texture: { src: "t.webp" } },
    _source: { system: src.system },
    toObject: () => ({ items: src.items }),
  };
  const actor = new Proxy(real, {
    get(t, k) {
      if (k === "system") throw new Error("read the derived actor.system");
      return t[k];
    },
  });
  const uuids = [];
  const { snapshot, resolved } = await loadActorSnapshot(actor, {
    fromUuid: async (u) => { uuids.push(u); return u === CLASS_UUID ? RESOLVED.class : null; },
    loadSpells: async () => [{ uuid: "Compendium.s.Item.light", name: "Light", system: { tier: 1, class: [CLASS_UUID] } }],
    defaultArt: [],
  });
  assert.equal(snapshot.tokenImg, "t.webp");
  assert.equal(snapshot.system.abilities.str.value, 15);
  assert.equal(resolved.class.name, "Fighter");
  assert.equal(resolved.ancestry, null);
  assert.ok(uuids.includes(ANC_UUID));
  assert.equal(resolved.spellPool[0].uuid, "Compendium.s.Item.light");
  const st = hydrateState(snapshot, resolved);
  assert.equal(st.spells[0].uuid, "Compendium.s.Item.light");
  assert.equal(st.stats.values.str, 15);
  // The snapshot is a copy: changing it leaves the actor's source alone.
  snapshot.system.abilities.str.value = 1;
  assert.equal(real._source.system.abilities.str.value, 15);
});

test("hydration needs no crypto.randomUUID (it does not exist on http LAN clients)", () => {
  const noId = snap();
  delete noId.sessionId;
  const proto = Object.getPrototypeOf(globalThis.crypto);
  const saved = Object.getOwnPropertyDescriptor(proto, "randomUUID");
  Object.defineProperty(proto, "randomUUID", { value: undefined, configurable: true });
  try {
    const a = hydrateState(noId, RESOLVED).existing.sessionId;
    const b = hydrateState(noId, RESOLVED).existing.sessionId;
    assert.ok(a && b && a !== b, "a fresh non-empty id per open");
    globalThis.foundry = { utils: { randomID: () => "fid12345" } };
    assert.equal(hydrateState(noId, RESOLVED).existing.sessionId, "fid12345", "the house helper wins when present");
  } finally {
    delete globalThis.foundry;
    Object.defineProperty(proto, "randomUUID", saved);
  }
});
