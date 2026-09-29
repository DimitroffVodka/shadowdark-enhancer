import test from "node:test";
import assert from "node:assert/strict";
import { hydrateState } from "../scripts/char-builder/hydrate.mjs";
import { planCommit, planIsEmpty, hpLevelUpGain, xpAfterLevelUp } from "../scripts/char-builder/commit-plan.mjs";

const CLASS_UUID = "Compendium.shadowdark.classes.Item.fighter";
const ANC_UUID = "Compendium.shadowdark.ancestries.Item.dwarf";
const LANG_A = "Compendium.shadowdark.languages.Item.common";
const LANG_B = "Compendium.shadowdark.languages.Item.dwarvish";
const LANG_C = "Compendium.shadowdark.languages.Item.elvish";
const MARK = "shadowdark-enhancer";

const item = (id, type, name, system = {}, flags = {}) => ({ _id: id, type, name, img: "i.webp", system, flags, _stats: {} });
const gear = (id, name, qty = 1, type = "Basic") =>
  item(id, type, name, { quantity: qty, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } });

function sysOf(over = {}) {
  return {
    abilities: { str: { value: 15 }, dex: { value: 10 }, con: { value: 14 }, int: { value: 8 }, wis: { value: 12 }, cha: { value: 9 } },
    level: { value: 1, xp: 3 },
    alignment: "lawful",
    ancestry: ANC_UUID,
    class: CLASS_UUID,
    background: "Compendium.shadowdark.backgrounds.Item.smith",
    deity: null,
    patron: null,
    attributes: { hp: { max: 9, value: 11 } },
    coins: { gp: 0, sp: 25, cp: 0 },
    languages: [LANG_A, LANG_B],
    ...over,
  };
}

const ITEMS = () => [
  gear("t1", "Torch", 1), gear("t2", "Torch", 1), gear("rope", "Rope", 3),
  gear("sword", "Sword", 1, "Weapon"),
  item("sp1", "Spell", "Burning Hands", { tier: 1 }, { core: { sourceId: "Compendium.x.spells.Item.bh" } }),
  item("sp2", "Spell", "Sleep", { tier: 1 }),
  item("tal1", "Talent", "Stout"), item("tal2", "Talent", "Weapon Mastery (Longsword)"),
  item("eff1", "Effect", "Damage: STR (-1)"), item("ca1", "Class Ability", "Rage"),
];

function snap(sys = sysOf(), items = ITEMS()) {
  return {
    actorId: "actor1", sessionId: "sess1", name: "Dwarf Fighter 1",
    img: "icons/svg/mystery-man.svg", tokenImg: null, defaultArt: ["icons/svg/mystery-man.svg"],
    system: sys, items,
  };
}
const RESOLVED = {
  class: { uuid: CLASS_UUID, name: "Fighter", system: { spellcasting: { class: "__not_spellcaster__" } } },
  ancestry: { uuid: ANC_UUID, name: "Dwarf", system: {} },
  spellPool: [],
};

/** A hydrated builder plus a live actor identical to it: `{ st, existing, live }`. */
function open(sys = sysOf(), items = ITEMS()) {
  const st = hydrateState(snap(structuredClone(sys), structuredClone(items)), RESOLVED);
  return {
    st,
    existing: st.existing,
    live: { source: { name: "Dwarf Fighter 1", img: "icons/svg/mystery-man.svg", system: structuredClone(sys) }, items: structuredClone(items) },
  };
}

test("open and Finish without touching anything is a strict no-op", () => {
  const { st, existing, live } = open();
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.system, {});
  assert.equal(plan.name, null);
  assert.deepEqual(plan.art, {});
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.deletes, []);
  assert.deepEqual(plan.drift, []);
  assert.ok(planIsEmpty(plan));
  assert.equal(plan.kept.length, 4);
});

test("two Torch rows: removing one deletes exactly that id", () => {
  const { st, existing, live } = open();
  st.gear = st.gear.filter((g) => g.itemId !== "t2");
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.deletes, ["t2"]);
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.creates, []);
});

test("a quantity edit is one absolute update, no create, no delete", () => {
  const { st, existing, live } = open();
  st.gear.find((g) => g.itemId === "rope").qty = 5;
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.updates, [{ _id: "rope", "system.quantity": 5 }]);
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.deletes, []);
  assert.deepEqual(plan.drift, []);
});

test("a quantity taken to 0 removes the row", () => {
  const { st, existing, live } = open();
  st.gear.find((g) => g.itemId === "rope").qty = 0;
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.deletes, ["rope"]);
  assert.deepEqual(plan.updates, []);
});

test("a quantity edit over a concurrent quantity change writes and shows drift", () => {
  const { st, existing, live } = open();
  st.gear.find((g) => g.itemId === "rope").qty = 5;
  live.items.find((i) => i._id === "rope").system.quantity = 4;
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.updates, [{ _id: "rope", "system.quantity": 5 }]);
  assert.equal(plan.drift.length, 1);
  assert.equal(plan.drift[0].key, "quantity:rope");
  assert.equal(plan.drift[0].live, 4);
});

test("a quantity already at the wanted value in the live actor is not rewritten", () => {
  const { st, existing, live } = open();
  st.gear.find((g) => g.itemId === "rope").qty = 5;
  live.items.find((i) => i._id === "rope").system.quantity = 5;
  assert.deepEqual(planCommit(existing, st, live).updates, []);
});

test("a new purchase never merges into an owned row", () => {
  const { st, existing, live } = open();
  st.gear.push({ rowId: "new1", itemId: null, uuid: "Compendium.x.Item.torch", name: "Torch", qty: 1, costCp: 50 });
  const plan = planCommit(existing, st, live);
  assert.equal(plan.creates.length, 1);
  assert.deepEqual(plan.creates[0], { rowId: "sess1:new1", kind: "gear", uuid: "Compendium.x.Item.torch", name: "Torch", qty: 1 });
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.deletes, []);
  // 25 sp - 50 cp = 200 cp -> 2 gp
  assert.deepEqual(plan.system, { "system.coins.gp": 2, "system.coins.sp": 0, "system.coins.cp": 0 });
});

test("a create already on the live actor (its builderRow marker) is done, not repeated", () => {
  const { st, existing, live } = open();
  st.gear.push({ rowId: "new1", itemId: null, uuid: "u", name: "Torch", qty: 1, costCp: 0 });
  live.items.push(item("made", "Basic", "Torch", {}, { [MARK]: { builderRow: "sess1:new1" } }));
  assert.deepEqual(planCommit(existing, st, live).creates, []);
});

test("a row created in an earlier attempt and removed since is deleted by its marker", () => {
  const { st, existing, live } = open();
  existing.createdRowIds = ["sess1:new1"];
  live.items.push(item("made", "Basic", "Torch", {}, { [MARK]: { builderRow: "sess1:new1" } }));
  assert.deepEqual(planCommit(existing, st, live).deletes, ["made"]);
});

test("a row made by an earlier session is never deleted by this one, even if listed", () => {
  const { st, existing, live } = open();
  existing.createdRowIds = ["old:new1"];
  live.items.push(item("made", "Basic", "Torch", {}, { [MARK]: { builderRow: "old:new1" } }));
  assert.deepEqual(planCommit(existing, st, live).deletes, []);
});

test("a typed name is planned trimmed, and a blank one writes nothing", () => {
  const { st, existing, live } = open();
  st.name = "Bob ";
  assert.equal(planCommit(existing, st, live).name, "Bob");
  st.name = "  ";
  assert.equal(planCommit(existing, st, live).name, null);
});

test("created spell, trinket and gear rows are all session-scoped markers", () => {
  const { st, existing, live } = open();
  st.spells.push({ itemId: null, uuid: "Compendium.x.Item.light", name: "Light", tier: 1 });
  st.trinket = "Lucky coin";
  st.gear.push({ rowId: null, itemId: null, uuid: "Compendium.x.Item.torch", name: "Torch", qty: 1, costCp: 0 });
  const ids = planCommit(existing, st, live).creates.map((c) => c.rowId).sort();
  assert.deepEqual(ids, [
    "sess1:Compendium.x.Item.torch#1", "sess1:spell:Compendium.x.Item.light", "sess1:trinket:Lucky coin",
  ]);
});

test("a created row already listed as made is not created again, and a wanted one is not deleted", () => {
  const { st, existing, live } = open();
  st.spells.push({ itemId: null, uuid: "Compendium.x.Item.light", name: "Light", tier: 1 });
  existing.createdRowIds = ["sess1:spell:Compendium.x.Item.light"];
  let plan = planCommit(existing, st, live);
  assert.deepEqual([plan.creates, plan.deletes], [[], []], "spent on the sheet: not granted again");
  live.items.push(item("made", "Spell", "Light", {}, { [MARK]: { builderRow: "sess1:spell:Compendium.x.Item.light" } }));
  plan = planCommit(existing, st, live);
  assert.deepEqual([plan.creates, plan.deletes], [[], []], "still wanted: kept");
  st.spells.pop();
  assert.deepEqual(planCommit(existing, st, live).deletes, ["made"]);
});

test("coins compare in copper: 25 sp untouched writes nothing; a change writes all three normalized", () => {
  const { st, existing, live } = open();
  assert.deepEqual(planCommit(existing, st, live).system, {});
  st.coins = { gp: 0, sp: 26, cp: 0 };
  assert.deepEqual(planCommit(existing, st, live).system, { "system.coins.gp": 2, "system.coins.sp": 6, "system.coins.cp": 0 });
});

test("empty and null UUIDs are the same; a changed background is written", () => {
  const { st, existing, live } = open();
  st.deity = { uuid: "", name: "" };
  assert.deepEqual(planCommit(existing, st, live).system, {});
  st.deity = null;
  assert.deepEqual(planCommit(existing, st, live).system, {});
  st.background = { uuid: "Compendium.shadowdark.backgrounds.Item.thief", name: "Thief" };
  assert.deepEqual(planCommit(existing, st, live).system, { "system.background": "Compendium.shadowdark.backgrounds.Item.thief" });
  st.background = null;
  assert.deepEqual(planCommit(existing, st, live).system, { "system.background": null });
});

test("only changed abilities are written, as the base value", () => {
  const { st, existing, live } = open();
  st.stats.values.str = 17;
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.system, { "system.abilities.str.value": 17 });
});

test("concurrent edit: coins drifted while the user only changed alignment -> coins not written, no drift", () => {
  const { st, existing, live } = open();
  st.alignment = "chaotic";
  live.source.system.coins = { gp: 1, sp: 0, cp: 0 };
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.system, { "system.alignment": "chaotic" });
  assert.deepEqual(plan.drift, []);
});

test("the user changed coins and live drifted -> written, with a drift line", () => {
  const { st, existing, live } = open();
  st.coins = { gp: 0, sp: 30, cp: 0 };
  live.source.system.coins = { gp: 1, sp: 0, cp: 0 };
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.system, { "system.coins.gp": 3, "system.coins.sp": 0, "system.coins.cp": 0 });
  assert.equal(plan.drift.length, 1);
  assert.equal(plan.drift[0].key, "coins");
  assert.equal(plan.drift[0].baseline, 250);
  assert.equal(plan.drift[0].live, 100);
});

test("an unresolved ancestry or class is never in the system diff", () => {
  const st = hydrateState(snap(), {});
  assert.ok(st.ancestry.unresolved && st.class.unresolved);
  const live = { source: { name: "Dwarf Fighter 1", system: sysOf() }, items: ITEMS() };
  assert.ok(planIsEmpty(planCommit(st.existing, st, live)));
  st.alignment = "chaotic";
  const keys = Object.keys(planCommit(st.existing, st, live).system);
  assert.deepEqual(keys, ["system.alignment"]);
});

test("a Funnel (level 0) plan writes no class or level keys", () => {
  const sys = sysOf({ class: null, ancestry: null, level: { value: 0, xp: 0 } });
  const { st, existing, live } = open(sys, [gear("t1", "Torch")]);
  st.stats.values.str = 12;
  st.alignment = "chaotic";
  const keys = Object.keys(planCommit(existing, st, live).system);
  assert.deepEqual(keys.sort(), ["system.abilities.str.value", "system.alignment"]);
});

test("languages: the diff is by UUID and is applied to the live list, not the baseline", () => {
  const { st, existing, live } = open();
  st.languages = [LANG_A, LANG_C];
  live.source.system.languages = [LANG_A, LANG_B, "Compendium.shadowdark.languages.Item.orcish"];
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.system["system.languages"], [LANG_A, "Compendium.shadowdark.languages.Item.orcish", LANG_C]);
  // unchanged list -> nothing
  const again = open();
  assert.deepEqual(planCommit(again.existing, again.st, again.live).system, {});
});

test("spells: unchecking deletes that id only; a new pick is created from its uuid", () => {
  const { st, existing, live } = open();
  st.spells = st.spells.filter((s) => s.itemId !== "sp2");
  st.spells.push({ uuid: "Compendium.x.spells.Item.mm", name: "Magic Missile", tier: 1 });
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.deletes, ["sp2"]);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].kind, "spell");
  assert.equal(plan.creates[0].uuid, "Compendium.x.spells.Item.mm");
});

test("a spell with no compendium match is kept unless removed", () => {
  const { st, existing, live } = open();
  assert.equal(st.spells.find((s) => s.itemId === "sp2").uuid, null);
  assert.deepEqual(planCommit(existing, st, live).deletes, []);
});

test("an item deleted elsewhere since open is not deleted again", () => {
  const { st, existing, live } = open();
  st.gear = st.gear.filter((g) => g.itemId !== "t2");
  live.items = live.items.filter((i) => i._id !== "t2");
  assert.deepEqual(planCommit(existing, st, live).deletes, []);
});

test("a new trinket is created once; art and name only when changed", () => {
  const { st, existing, live } = open();
  st.trinket = "A lucky coin";
  st.art = { portrait: "a/p.webp", token: null };
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.creates.map((c) => [c.kind, c.name]), [["trinket", "A lucky coin"]]);
  assert.equal(plan.name, null);
  assert.deepEqual(plan.art, { portrait: "a/p.webp" });
  st.name = "Grum";
  assert.equal(planCommit(existing, st, live).name, "Grum");
  st.name = "";
  assert.equal(planCommit(existing, st, live).name, null);
});

test("a deleted or ownerless actor aborts before any plan", () => {
  const { st, existing } = open();
  assert.throws(() => planCommit(existing, st, null), /gone/);
});

test("emptying the builder deletes only the hydrated gear and spells, never a kept item", () => {
  const { st, existing, live } = open();
  st.gear = []; st.spells = [];
  const plan = planCommit(existing, st, live);
  assert.deepEqual(plan.deletes.sort(), ["rope", "sp1", "sp2", "sword", "t1", "t2"]);
});

test("a planner bug that would delete a kept id throws instead", () => {
  const { st, existing, live } = open();
  st.gear = [];
  // corrupt the baseline so a kept item also looks like a hydrated gear row
  existing.gearRows.push({ itemId: "tal1", name: "Stout", type: "Basic", qty: 1 });
  assert.throws(() => planCommit(existing, st, live), /kept/);
});

test("hpLevelUpGain sums the dice with no CON; xp carries over with a 0 floor", () => {
  assert.equal(hpLevelUpGain([4, 6]), 10);
  assert.equal(hpLevelUpGain([]), 0);
  assert.equal(xpAfterLevelUp(35, 1, 3), 5); // 10 + 20 crossed
  assert.equal(xpAfterLevelUp(12, 1, 2), 2);
  assert.equal(xpAfterLevelUp(5, 1, 3), 0); // floor
  assert.equal(xpAfterLevelUp(9, 0, 1), 0); // level 0 carries nothing
});

// ---- property-style: many random opens, edits and drifts ----

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test("property: deletes are only hydrated-and-removed ids, never kept; updates never touch kept", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const pick = (p) => r() < p;
    const items = [];
    const n = 3 + Math.floor(r() * 8);
    const types = ["Basic", "Weapon", "Armor", "Potion", "Spell", "Talent", "Effect", "Class Ability", "Boon"];
    for (let i = 0; i < n; i++) {
      const type = types[Math.floor(r() * types.length)];
      items.push(type === "Spell"
        ? item(`i${i}`, "Spell", `S${i}`, { tier: 1 })
        : gear(`i${i}`, r() < 0.4 ? "Torch" : `G${i}`, 1 + Math.floor(r() * 4), type));
    }
    const { st, existing, live } = open(sysOf(), items);
    const removedByUser = new Set();
    for (const g of [...st.gear]) {
      const roll = r();
      if (roll < 0.3) { st.gear = st.gear.filter((x) => x !== g); removedByUser.add(g.itemId); }
      else if (roll < 0.6) {
        g.qty = Math.floor(r() * 6);
        if (g.qty < 1) removedByUser.add(g.itemId);
      }
    }
    for (const s of [...st.spells]) {
      if (pick(0.3)) { st.spells = st.spells.filter((x) => x !== s); removedByUser.add(s.itemId); }
    }
    if (pick(0.5)) st.gear.push({ rowId: `n${seed}`, itemId: null, uuid: "u", name: "Torch", qty: 1, costCp: 50 });
    // drift: drop, requantity or add live items
    live.items = live.items.filter(() => !pick(0.15));
    for (const li of live.items) if (li.system.quantity != null && pick(0.2)) li.system.quantity = 1 + Math.floor(r() * 9);
    if (pick(0.5)) live.items.push(gear(`x${seed}`, "Extra", 1));
    if (pick(0.5)) live.source.system.coins = { gp: Math.floor(r() * 50), sp: 0, cp: 0 };

    const plan = planCommit(existing, st, live);
    const kept = new Set(existing.kept.map((k) => k.id));
    const liveIds = new Set(live.items.map((i) => i._id));
    const hydrated = new Set([...existing.gearRows, ...existing.spellRows].map((x) => x.itemId));
    for (const id of plan.deletes) {
      assert.ok(!kept.has(id), `seed ${seed}: kept id ${id} deleted`);
      assert.ok(hydrated.has(id) && removedByUser.has(id), `seed ${seed}: ${id} was not removed by the user`);
      assert.ok(liveIds.has(id), `seed ${seed}: ${id} no longer exists`);
    }
    for (const u of plan.updates) {
      assert.ok(!kept.has(u._id) && liveIds.has(u._id) && hydrated.has(u._id));
      assert.ok(!plan.deletes.includes(u._id));
    }
    assert.equal(new Set(plan.deletes).size, plan.deletes.length);
    // an item nobody hydrated is never touched
    assert.ok(!plan.deletes.includes(`x${seed}`) && !plan.updates.some((u) => u._id === `x${seed}`));
  }
});
