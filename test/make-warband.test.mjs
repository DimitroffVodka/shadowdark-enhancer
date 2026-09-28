// Make a Warband, through the creation path: one attack a round, its spells included (#202, #283 review).
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

/** A level 2 NPC with a staff that attacks `staffAttacks` times and a spell count of `spells`. */
function npc({ spells, staffAttacks }) {
  const data = {
    _id: "npc", name: "Hedge Mage", type: "NPC", img: "worlds/test/mage.webp", flags: {},
    prototypeToken: { name: "Hedge Mage", texture: { src: "worlds/test/mage.webp" } },
    system: {
      level: { value: 2 }, alignment: "N", move: "near", notes: "",
      abilities: { str: { mod: 0 }, dex: { mod: 1 }, con: { mod: 0 }, int: { mod: 2 }, wis: { mod: 0 }, cha: { mod: 0 } },
      attributes: { ac: { value: 11 }, hp: { value: 9, max: 9 } },
      spellcasting: { ability: "int", bonus: 4, attacks: spells },
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
  assert.equal(warband.system.spellcasting.bonus, 4);
  assert.equal(atkLine(warband), "1 staff +3 (3d6) or 1 spell +4");
  assert.deepEqual(previewRow("Staff"), ["2 × +1 (1d6)", "1 × +3 (3d6)"]);
  assert.deepEqual(previewRow("Spells"), ["2 × +4", "1 × +4"], "the preview shows what's made");
});

test("a creature with no spell count gets none", async () => {
  const warband = await makeWarband(npc({ spells: 0, staffAttacks: 1 }), "shadowdark-enhancer.warband");
  assert.equal(warband.system.spellcasting.attacks, 0);
  assert.equal(atkLine(warband), "1 staff +3 (3d6)");
  assert.equal(previewRow("Spells"), undefined);
});
