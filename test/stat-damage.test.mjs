/**
 * Stat damage (#182) — one Active Effect per damaged ability, summed however
 * many there are, healed whole or one point per ability, and CON 0 kills.
 *
 * The modifier following the score is the system's doing, not ours: its
 * ability `mod` is a getter on `value` (attributeModel, shadowdark-compiled.mjs),
 * so an ADD on `system.abilities.<key>.value` moves both. Checked against the
 * system source; not re-asserted here.
 *
 * The Foundry-bound half runs against a fake actor that keeps effects in a Map
 * and throws when asked to delete one that is already gone, as the server does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ABILITIES, abilityKey, afterHeal, damageOf, effectAmount, statDamageEffect,
} from "../scripts/stat-damage/stat-damage-core.mjs";
import { StatDamage } from "../scripts/stat-damage/stat-damage.mjs";

const FLAG = (ability) => ({ "shadowdark-enhancer": { statDamage: { ability } } });

/** The Effects-library entry, exactly as shadowdark-extras#148 builds it. */
const libraryDrop = (ability) => ({
  name: `${ability.toUpperCase()} damage`,
  changes: [{ key: `system.abilities.${ability}.value`, mode: 2, value: "-1" }],
  flags: FLAG(ability),
});

// ─── The pure half ─────────────────────────────────────────────────────────

test("ability keys: abbreviation, any case, or the full name", () => {
  assert.equal(abilityKey("STR"), "str");
  assert.equal(abilityKey("con"), "con");
  assert.equal(abilityKey("Charisma"), "cha");
  assert.equal(abilityKey("luck"), null);
  assert.equal(abilityKey(undefined), null);
});

test("a word that merely starts like an ability is not one", () => {
  for (const word of ["strike", "control", "charm", "intent", "wise", "dexter", "st"]) {
    assert.equal(abilityKey(word), null, word);
  }
  assert.equal(abilityKey(" Dexterity "), "dex");
});

test("a character never damaged reads zero in all six", () => {
  assert.deepEqual(damageOf([]), Object.fromEntries(ABILITIES.map((a) => [a, 0])));
  // An unrelated effect is not stat damage, even one that lowers a score.
  const curse = { changes: [{ key: "system.abilities.str.value", mode: 2, value: "-3" }], flags: {} };
  assert.equal(damageOf([curse]).str, 0);
});

test("two one-point STR effects read the same as one two-point effect", () => {
  const two = statDamageEffect("str", 2, "2 STR damage");
  assert.deepEqual(damageOf([libraryDrop("str"), libraryDrop("str")]), damageOf([two]));
  assert.equal(damageOf([two]).str, 2);
});

test("v14's system.changes with a parsed number reads the same as v13's string", () => {
  const v14 = {
    system: { changes: [{ key: "system.abilities.con.value", type: "add", value: -3 }] },
    flags: FLAG("con"),
  };
  assert.equal(effectAmount(v14), 3);
});

test("the effect is the contract shape: a negative ADD on the score, flagged", () => {
  const e = statDamageEffect("wis", 3, "3 WIS damage");
  assert.deepEqual(e.changes, [{ key: "system.abilities.wis.value", mode: 2, value: "-3" }]);
  assert.deepEqual(e.flags, FLAG("wis"));
  assert.ok(!("duration" in e), "lasts until healed");
});

test("a rest heals all; Grinder heals one per damaged ability", () => {
  const hurt = { ...damageOf([]), str: 2, con: 1 };
  assert.deepEqual(afterHeal(hurt), damageOf([]));
  assert.deepEqual(afterHeal(hurt, { all: true }), damageOf([]));
  assert.deepEqual(afterHeal(hurt, { perAbility: 1 }), { ...damageOf([]), str: 1 });
  assert.deepEqual(afterHeal(hurt, { perAbility: 0 }), hurt, "0 heals nothing, not everything");
  assert.deepEqual(afterHeal(hurt, { perAbility: 1, all: true }), damageOf([]));
});

// ─── The Foundry-bound half ────────────────────────────────────────────────

function fakeActor({ type = "Player", con = 10 } = {}) {
  const store = new Map();
  let next = 0;
  const actor = {
    type, id: "a1", uuid: "Actor.a1", isToken: false, documentName: "Actor",
    statuses: new Set(),
    system: { abilities: { con: { value: con } } },
    get effects() { return [...store.values()]; },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) if (!store.delete(id)) throw new Error(`${id} does not exist`);
    },
    async createEmbeddedDocuments(_type, data) {
      for (const d of data) {
        const id = `e${++next}`;
        store.set(id, { ...structuredClone(d), id, parent: actor });
      }
    },
    async toggleStatusEffect(id, { active }) { if (active) actor.statuses.add(id); },
  };
  return actor;
}

globalThis.game = {
  i18n: {
    localize: (k) => ({ "SHADOWDARK.ability_str": "Str", "SHADOWDARK.ability_con": "Con" })[k] ?? k,
    format: (_k, { amount, ability }) => `${amount} ${ability} damage`,
  },
  user: { id: "gm", isGM: true },
  users: { activeGM: { id: "gm" } },
  combats: [],
};

test("2 STR damage is one effect, named for what it does", async () => {
  const actor = fakeActor();
  assert.equal(await StatDamage.apply(actor, "STR", 2), 2);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].name, "2 STR damage");
  assert.equal(StatDamage.of(actor).str, 2);
});

test("more damage to the same ability stays one effect, even from library drops", async () => {
  const actor = fakeActor();
  await actor.createEmbeddedDocuments("ActiveEffect", [libraryDrop("str"), libraryDrop("str")]);
  assert.equal(await StatDamage.apply(actor, "str", 1), 3);
  assert.equal(actor.effects.length, 1);
  assert.equal(StatDamage.of(actor).str, 3);
});

test("two hits landing together both count, and neither deletes the other's effect", async () => {
  const actor = fakeActor();
  await StatDamage.apply(actor, "str", 1);
  await Promise.all([StatDamage.apply(actor, "str", 1), StatDamage.apply(actor, "str", 1)]);
  assert.equal(StatDamage.of(actor).str, 3);
  assert.equal(actor.effects.length, 1);
});

test("a rest removes it; Grinder takes one off each and leaves the rest", async () => {
  const actor = fakeActor();
  await StatDamage.apply(actor, "str", 2);
  await StatDamage.apply(actor, "con", 1);
  assert.deepEqual(await StatDamage.heal(actor, { perAbility: 1 }), { ...damageOf([]), str: 1 });
  assert.deepEqual(actor.effects.map((e) => e.name), ["1 STR damage"]);
  await StatDamage.heal(actor);
  assert.equal(actor.effects.length, 0);
});

test("nothing touches a character with no stat damage, or an NPC", async () => {
  const actor = fakeActor();
  actor.deleteEmbeddedDocuments = () => assert.fail("nothing to delete");
  actor.createEmbeddedDocuments = () => assert.fail("nothing to create");
  await StatDamage.heal(actor);
  assert.equal(await StatDamage.apply(fakeActor({ type: "NPC" }), "str", 1), null);
  assert.equal(await StatDamage.apply(actor, "luck", 1), null);
  assert.equal(await StatDamage.apply(actor, "str", 0), null);
});

test("CON reaching 0 kills; above 0, or another ability, does not", async () => {
  const dying = fakeActor({ con: 0 });
  await StatDamage._checkCon({ ...statDamageEffect("con", 10, ""), parent: dying });
  assert.ok(dying.statuses.has("dead"));

  const alive = fakeActor({ con: 1 });
  await StatDamage._checkCon({ ...statDamageEffect("con", 9, ""), parent: alive });
  assert.ok(!alive.statuses.has("dead"));

  const weak = fakeActor({ con: 0 });
  await StatDamage._checkCon({ ...statDamageEffect("str", 10, ""), parent: weak });
  assert.ok(!weak.statuses.has("dead"));
});

test("two CON effects created in one batch mark the character dead once", async () => {
  const actor = fakeActor({ con: 0 });
  let toggles = 0;
  actor.toggleStatusEffect = async (id) => {
    toggles++;
    await null; // the status lands after a server round trip, not at once
    actor.statuses.add(id);
  };
  const effect = { ...statDamageEffect("con", 5, ""), parent: actor };
  await Promise.all([StatDamage._checkCon(effect), StatDamage._checkCon(effect)]);
  assert.equal(toggles, 1);
});

test("only the active GM kills, so every client seeing the effect does not race", async () => {
  const actor = fakeActor({ con: 0 });
  globalThis.game.user = { id: "player", isGM: false };
  try {
    await StatDamage._checkCon({ ...statDamageEffect("con", 10, ""), parent: actor });
  } finally {
    globalThis.game.user = { id: "gm", isGM: true };
  }
  assert.ok(!actor.statuses.has("dead"));
});
