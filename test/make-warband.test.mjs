// Make a Warband, through the creation path: one attack a round, its spells included (#202, #283 review),
// and a caster's spell bonus up by the levels gained, as its attacks' (Patrick, 2026-09-28).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWarband } from "../scripts/actors/make-warband.mjs";

const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
const t = (key) => en[key] ?? key;
let preview = "";
globalThis.CONST = { DEFAULT_TOKEN: "icons/svg/mystery-man.svg" };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: t, format: (key, data) => t(key).replace(/\{(\w+)\}/g, (_m, k) => data?.[k] ?? "") },
};
globalThis.foundry = {
  applications: {
    handlebars: {},
    api: { DialogV2: { confirm: async ({ content }) => { preview = content; return true; } } },
  },
  utils: { deepClone: structuredClone, randomID: () => Math.random().toString(36).slice(2) },
};
// The created actor is its creation data; the stat block lands in its notes.
globalThis.Actor = {
  implementation: {
    create: async (data) => {
      const actor = { ...data, update: async (changes) => { actor.system.notes = changes["system.notes"]; } };
      return actor;
    },
  },
};

/** A level 2 NPC with a staff that attacks `staffAttacks` times, and a spell count of `spells` at `spellBonus`. */
function npc({ spells, staffAttacks, spellBonus = 4 }) {
  const data = {
    _id: "npc", name: "Hedge Mage", type: "NPC", img: "worlds/test/mage.webp", flags: {},
    prototypeToken: { name: "Hedge Mage", texture: { src: "worlds/test/mage.webp" } },
    system: {
      level: { value: 2 }, alignment: "N", move: "near", notes: "",
      abilities: { str: { mod: 0 }, dex: { mod: 1 }, con: { mod: 0 }, int: { mod: 2 }, wis: { mod: 0 }, cha: { mod: 0 } },
      attributes: { ac: { value: 11 }, hp: { value: 9, max: 9 } },
      spellcasting: { ability: "int", bonus: spellBonus, attacks: spells },
    },
    items: [{
      _id: "staff", name: "Staff", type: "NPC Attack",
      system: { attack: { num: staffAttacks }, bonuses: { attackBonus: 1 }, damage: { value: "1d6" }, ranges: ["close"] },
    }],
  };
  return { name: data.name, type: data.type, pack: null, folder: null, system: data.system, toObject: () => structuredClone(data) };
}

const atkLine = (actor) => /<strong>ATK<\/strong> ([^,]*)/.exec(actor.system.notes)?.[1];
const previewRow = (label) => new RegExp(`<tr><td>${label}</td><td>([^<]*)</td><td>([^<]*)</td></tr>`).exec(preview)?.slice(1);

test("a caster made into a warband has one attack a round: its spells are one choice among its attacks", async () => {
  const warband = await makeWarband(npc({ spells: 2, staffAttacks: 2 }), "shadowdark-enhancer.warband");
  const staff = warband.items.find((i) => i.name === "Staff").system;
  assert.deepEqual([staff.attack.num, staff.bonuses.attackBonus, staff.damage.value], [1, 3, "3d6"]);
  assert.equal(warband.system.spellcasting.attacks, 1, "the NPC Spells tab's spell count");
  assert.equal(warband.system.spellcasting.bonus, 6);
  assert.equal(atkLine(warband), "1 staff +3 (3d6) or 1 spell +6");
  assert.deepEqual(previewRow("Staff"), ["2 × +1 (1d6)", "1 × +3 (3d6)"]);
  assert.deepEqual(previewRow("Spells"), ["2 × +4", "1 × +6"], "the preview shows what's made");
});

test("a level 2 caster with spell +2 becomes a level 4 warband with spell +4", async () => {
  const warband = await makeWarband(npc({ spells: 1, staffAttacks: 1, spellBonus: 2 }), "shadowdark-enhancer.warband");
  assert.equal(warband.system.level.value, 4);
  assert.equal(warband.system.spellcasting.bonus, 4);
  assert.equal(atkLine(warband), "1 staff +3 (3d6) or 1 spell +4");
  assert.deepEqual(previewRow("Spells"), ["1 × +2", "1 × +4"]);
});

test("a creature with no spell count gets none", async () => {
  const warband = await makeWarband(npc({ spells: 0, staffAttacks: 1 }), "shadowdark-enhancer.warband");
  assert.equal(warband.system.spellcasting.attacks, 0);
  assert.equal(atkLine(warband), "1 staff +3 (3d6)");
  assert.equal(previewRow("Spells"), undefined);
});

test("the Actors directory entry shows for a GM on a level 1-5 NPC only, and clicking makes the warband from a copy of it", async () => {
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); return 1; } };
  const { registerMakeWarband } = await import("../scripts/actors/make-warband.mjs");
  registerMakeWarband("shadowdark-enhancer.warband");
  const actors = {
    low: npc({ spells: 0, staffAttacks: 1 }),
    high: { type: "NPC", system: { level: { value: 6 } } },
    player: { type: "Player", system: { level: { value: 3 } } },
  };
  const items = [];
  for (const fn of hooks.getActorContextOptions) fn({ collection: { get: (id) => actors[id] } }, items);
  const li = (id) => ({ closest: () => ({ dataset: { entryId: id } }) });
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "SDE.warband.make.button");
  assert.deepEqual(["low", "high", "player"].map((id) => items[0].visible(li(id))), [true, false, false]);
  // Clicking previews, then creates the warband from a copy; the original is untouched.
  const warband = await items[0].onClick({}, li("low"));
  assert.equal(warband.system.level.value, 4);
  assert.equal(actors.low.system.level.value, 2);
  assert.match(preview, /Hedge Mage/);
  // A GM's click on a non-NPC makes nothing.
  assert.equal(await items[0].onClick({}, li("player")), null);
  globalThis.game.user.isGM = false;
  assert.equal(items[0].visible(li("low")), false);
  globalThis.game.user.isGM = true;
});
